'use strict';

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

/******** App constants ******/
var DEBUG = true;
var STORAGE_DB = 'state-rss';
var STORAGE_CHANNEL = 'channel-rss';

/***** Some "functional" utilities ****/
var produce = immer.default.bind(immer);

//console.logs args and returns the last one
//This can be a bottleneck if we're logging ~1000 items at once. 
//How do I know? I've tested this function with and without side effects
//With log: lag with a few seconds. Without console.log: instantaneous
var log = function log() {
  for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
    args[_key] = arguments[_key];
  }

  return DEBUG ? console.log.apply(console, args) : null, args[args.length - 1];
};

var uuid = function uuid() {
  return (Math.random() + 1).toString(36).slice(2);
};

/***********
 * Model
 *********/
var init = function init() {
  return {
    sources: [{
      url: 'http://nautil.us/rss/all',
      category: 'Science',
      id: 'm4nfqca9oz'
    }, {
      url: 'https://www.theatlantic.com/feed/channel/business/',
      category: 'Business',
      id: 'gtie5vvssvl'
    }],
    cached_sources: {},
    cached_articles: []
  };
};

/**********************
 * Actions 
 **********************/

var initial_actions = function initial_actions(model) {
  return model.sources.map(function (source) {
    return request_feed(source.url);
  });
};

// Actions
var REQUEST_FEED = 'request_feed';
var REQUEST_FEED_RETURN = 'update_feed_cache';

var ADD_FEED_SOURCE = 'add_feed_source';
var REMOVE_FEED_SOURCE = 'remove_feed_source';
var UPDATE_FEED_SOURCE = 'update_feed_source';

// having unique identifiers not only helps with debugging, but is also
// necessary for the `storage` event to register repeated actions.
//
// "The storage event is fired on the window object whenever setItem(),
// removeItem(), or clear() is called and *actually changes something*. For
// example, if you set an item to its existing value or call clear() when there
// are no named keys, the storage event will not fire, because nothing actually
// changed in the storage area."
//
// From http://diveintohtml5.info/storage.html 
// (Accessed April 21, 2018)
var base_action = function base_action() {
  return {
    timestamp: new Date().toString(),
    uuid: uuid()
  };
};

var request_feed = function request_feed(url) {
  return _extends({}, base_action(), {
    type: REQUEST_FEED,
    url: url,
    replicate: false
  });
};
var request_feed_return = function request_feed_return(url, status, data) {
  return _extends({}, base_action(), {
    type: REQUEST_FEED_RETURN,
    url: url,
    status: status,
    data: data,
    replicate: false
  });
};

/* External actions */

var server_parsed = function server_parsed(url) {
  return axios.post('/api/rssparser', { url: url }).then(function (res) {
    return res.data;
  });
};

/* END external actions */

function update(action, model) {
  switch (action.type) {
    case REQUEST_FEED:
      server_parsed(action.url).then(function (data) {
        return actions(request_feed_return(action.url, 200, data));
      });
      return model;

    case REQUEST_FEED_RETURN:
      if (action.status === 200) return produce(model, function (d) {
        d.cached_sources[uuid()] = action.data;
      });else return model;

    case ADD_FEED_SOURCE:
    case REMOVE_FEED_SOURCE:
    case UPDATE_FEED_SOURCE:
      return model;

    default:
      console.log('BAAD! action not matched!');
      console.log('action: ', action);
      console.log('model: ', model);
      return model;
  }
}

var restoreState = function restoreState() {
  var restored = JSON.parse(localStorage.getItem(STORAGE_DB));
  return restored === null ? init() : restored;
};
var saveState = function saveState(model) {
  console.log('saving model: ', model);
  localStorage.setItem(STORAGE_DB, JSON.stringify(model));
};

/***** View *******/

var createVNode = Inferno.createVNode,
    createTextVNode = Inferno.createTextVNode;
var ViewArticle = function ViewArticle(model, source, article) {
  return createVNode(1, 'article', null, [createVNode(1, 'h1', null, article.title, 0), createVNode(1, 'div', null, [source.meta.title, createTextVNode(' ('), createVNode(1, 'a', null, new URI(article.permalink || article.link).hostname(), 0, {
    'href': article.permalink || article.link
  }), createTextVNode(') '), luxon.DateTime.fromISO(article.date).toLocaleString({
    month: "short", year: "numeric", day: 'numeric'
  })], 0), createVNode(1, 'div', null, createTextVNode('Summary'), 2), createVNode(1, 'div', 'summary', null, 1, {
    'dangerouslySetInnerHTML': { __html: DOMPurify.sanitize(article.summary) }
  })], 4, null, article.id);
};

var ViewMain = function ViewMain(model) {
  return createVNode(1, 'main', null, [R.pipe(R.chain(function (source) {
    return source.articles.map(function (a) {
      return {
        view: ViewArticle(model, source, a),
        data: a
      };
    });
  }), R.sort(function (a, b) {
    return new Date(a.data.date) < new Date(b.data.date) ? 1 : -1;
  }), R.map(R.prop("view")))(Object.values(model.cached_sources)), createVNode(1, 'p', 'footer', createTextVNode('That\'s it for now. Take a deep breath and enjoy some fresh air outside.'), 2)], 0);
};

function render(model) {
  Inferno.render(ViewMain(model), document.querySelector('main'));
}

// Streams
var actions = flyd.stream();
var saved_models = flyd.stream();

var model = flyd.scan(R.flip(update), restoreState(), actions);

actions.map(R.curryN(2, log)('action: '));

initial_actions(model()).forEach(function (a) {
  return actions(a);
});

model.map(R.curryN(2, log)('rendering with model: ')).map(function (model) {
  return requestAnimationFrame(R.curryN(2, render)(model));
});

flyd.on(function (model) {
  return actions() && actions().replicate ? saved_models(model) : null;
}, model);

flyd.on(saveState, saved_models);
//if (and only if) `actions` volume gets too high, should we throttle saveState


var incomingExternalActions$ = forwardTo(actions, function (action) {
  return log('incomingExternalActions$: ', _extends({}, action, { replicate: false }));
});

var outgoingExternalActions$ = filter(R.prop('replicate'), actions);

///// External listeners
window.addEventListener('storage', function (e) {
  if (e.key !== STORAGE_CHANNEL) return;
  try {
    var contents = JSON.parse(e.newValue);
    console.log('event from channel: ', contents);

    // "The StorageEvent is fired whenever a change is made to the Storage
    // object (note that this event is not fired for sessionStorage changes).
    // This won't work on the same page that is making the changes — it is
    // really a way for other pages on the domain using the storage to sync any
    // changes that are made."
    //
    // From https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API
    // (Accessed April 14, 2018)

    contents.replicate = false;
    incomingExternalActions$(contents);
  } catch (e) {
    console.error(e);
  }
});

// localstorage IS thread-safe. Therefore, writing to it at the same time 
// won't clash and produce gibberish. I'm pretty sure this means that for each 
// write, there will also be a 'storage' event emitted for the other tabs. 
// This post cites the W3C.
//
// See https://stackoverflow.com/questions/22001112/is-localstorage-thread-safe
// (Accessed April 14, 2018)
//
//
// The WHATWG seems to directly contradicts this. 
//
// This specification does not define the interaction with other browsing
// contexts in a multiprocess user agent, and authors are encouraged to assume
// that there is no locking mechanism. A site could, for instance, try to read the
// value of a key, increment its value, then write it back out, using the new
// value as a unique identifier for the session; if the site does this twice in
// two different browser windows at the same time, it might end up using the same
// "unique" identifier for both sessions, with potentially disastrous effects.
//
// From https://html.spec.whatwg.org/multipage/webstorage.html#localStorageEvent
// (Accessed April 21, 2018)

flyd.on(function (a) {
  return localStorage.setItem(STORAGE_CHANNEL, log('sending action: ', JSON.stringify(a)));
}, outgoingExternalActions$);

//# sourceMappingURL=reader.js.map