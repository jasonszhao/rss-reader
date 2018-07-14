import produce from 'immer'
import * as Inferno from 'inferno'
import flyd from 'flyd'
import* as R from 'ramda'
import axios from 'axios'
import DOMPurify from 'dompurify'
import luxon from 'luxon'
import URI from 'urijs'

import {forwardTo, filter} from './utils.js'

/******* Some debugging tools *********/

const reset_storage = () => localStorage.setItem(STORAGE_DB, JSON.stringify(init()))

/******** App constants ******/
const DEBUG = true
const STORAGE_DB = 'state-rss'
const STORAGE_CHANNEL = 'channel-rss'


/***** Some "functional" utilities ****/
//const produce = immer.default.bind(immer)

//console.logs args and returns the last one
//This can be a bottleneck if we're logging ~1000 items at once. 
//How do I know? I've tested this function with and without side effects
//With log: lag with a few seconds. Without console.log: instantaneous
const log = (...args) => 
    ( DEBUG ? console.log.apply(console, args) : null
    , args[args.length - 1]
    )

const uuid = () => (Math.random()+1).toString(36).slice(2) 

/***********
 * Model
 *********/
const init = () => ({
  source_categories: [
    {
      name: "Business",
      id: '3224lkjjf3'
    },
    {
      name: "Science",
      id: '2kl34jsllksf'
    },
    {
      name: "Uncategorized",
      id: '32l342lkj'
    }
  ],
  sources: [
    {
      url: 'http://nautil.us/rss/all',
      category_id: '2kl34jsllksf', 
      id: 'm4nfqca9oz',
    },
    {
      url: 'https://www.theatlantic.com/feed/channel/business/',
      category_id: '3224lkjjf3',
      id: 'gtieivvssvl'
    }
  ],
  cached_sources: {},
  cached_articles: []
})

/**********************
 * Actions 
 **********************/

const initial_actions = model => 
    model.sources.map(source => request_feed(source.url))

// Actions
const REQUEST_FEED = 'request_feed'
const REQUEST_FEED_RETURN = 'update_feed_cache'

const ADD_FEED_SOURCE = 'add_feed_source'
const REMOVE_FEED_SOURCE = 'remove_feed_source'
const UPDATE_FEED_SOURCE = 'update_feed_source'
const REORDER_FEED_SOURCE = 'reorder_feed_source'

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
const base_action = () => ({
    timestamp: (new Date()).toString(),
    uuid: uuid()
})

const request_feed = url => ({
    ...base_action(),
    type: REQUEST_FEED,
    url,
    replicate: false
})
const request_feed_return = (url, status, data) => ({
    ...base_action(),
    type: REQUEST_FEED_RETURN,
    url,
    status,
    data,
    replicate: false
})

const add_feed_source = (url, category_id) => ({
  ...base_action(),
  type: ADD_FEED_SOURCE,
  source_id: uuid(),
  url,
  category_id: category_id || '32l342lkj',
  replicate: true
})

const update_feed_source = (id, url, category_id) => ({
  ...base_action(),
  type: UPDATE_FEED_SOURCE,
  source_id: id,
  url,
  category_id: category_id,
  replicate: true
})

const remove_feed_source = id => ({
  ...base_action(),
  type: REMOVE_FEED_SOURCE,
  source_id: id,
  replicate: true
})

const reorder_feed_source = (source_id, place) => ({
  ...base_action(),
  type: REORDER_FEED_SOURCE,
  source_id,
  place,
  replicate: true
})


/* External actions */

const server_parsed = url => 
    axios.post('/api/rssparser', {url: url})
        .then(res => res.data)

/* END external actions */

function update(action, model) {
    switch(action.type) {
        case REQUEST_FEED: 
            server_parsed(action.url)
                .then(data => actions(request_feed_return(action.url, 200, data)))
            return model

        case REQUEST_FEED_RETURN:
            if(action.status === 200) 
                return produce(model, d => {
                    d.cached_sources[uuid()] = action.data
                })
            else
                return model

        case ADD_FEED_SOURCE:
            return produce(model, d => {
                d.sources.append({
                    url: action.url,
                    category_id: action.category_id,
                    id: action.source_id
                })
            })
        case REMOVE_FEED_SOURCE:
            return {
                ...model,
                sources: R.reject
                    ( source => action.source_id === source.id
                    , model.sources
                    )
            }
        case UPDATE_FEED_SOURCE:
            return {
                ...model,
                sources: model.sources.map(source =>
                    source.id === action.source_id 
                        ? {
                            ...source, 
                            url: action.url || source.url,
                            category_id: action.category_id || source.category_id
                        }
                        : source
                )
            }
        case REORDER_FEED_SOURCE:
            //reorder a feed source within its category

            return produce(model, d => {
                 
                const original_index = 
                    d.sources.findIndex(s => s.id === action.source_id)

                //remove the item from the sources list
                const [source] = d.sources.splice(original_index, 1)

                //iterate through the remaining list until we find the target_place
                let target_place = 0
                for (let i = 0; i < d.sources.length; i++) {
                    if(d.sources[i].category_id === source.category_id)
                        target_place++

                    if(target_place === action.place) {
                        d.sources.splice(i, 0, source)
                        return
                    }
                }
                //if the target place doesn't exist, put the source at the end 
                // of the sources list
                d.sources.push(source)
            })
              

        default:
            console.log('BAAD! action not matched!')
            console.log('action: ', action)
            console.log('model: ', model)
            return model
    }
}

const restoreState = () => {
    try {
        const restored = JSON.parse(localStorage.getItem(STORAGE_DB))
        return restored === null ? init() : restored
    }
    catch (e) {
        return init()
    }
}
const saveState = (model) => {
  console.log('saving model: ', model)
  localStorage.setItem(STORAGE_DB, JSON.stringify(model))
}

/***** View *******/

const ViewArticle = (model, source, article) => 
  <article key={article.id}>
    <h1>{article.title}</h1>
    <div>
      {source.meta.title } (<a href={article.permalink || article.link}>
    {(new URI(article.permalink || article.link)).hostname()}
      </a>) {
    luxon.DateTime.fromISO(article.date).toLocaleString({ 
      month: "short", year: "numeric", day: 'numeric'
    })
      }
    </div>
    <div>Summary</div>
    <div class="summary" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(article.summary)}}></div>
  </article>
  
const ViewMain = model => 
  <main>
  {
    R.pipe
      ( R.chain(source => source.articles.map(a => ({
            view: ViewArticle(model, source, a),
            data: a
        })))
      , R.sort( (a, b) => 
          new Date(a.data.date) < new Date(b.data.date) ? 1 : -1)
      , R.map(R.prop("view"))

    ) (Object.values(model.cached_sources))
  }
  <p class="footer"> 
    That's it for now. Take a deep breath and enjoy some fresh air outside.
  </p>
  </main>

function render (model) {
	Inferno.render
        ( ViewMain(model)
        , document.querySelector('main')
        )
}


// Streams
const actions = flyd.stream()
const saved_models = flyd.stream()



const model = flyd.scan(R.flip(update), restoreState(), actions)

actions
  .map(R.curryN(2, log)('action: '))

initial_actions(model()).forEach(a => actions(a))

model
  .map(R.curryN(2,log)('rendering with model: '))
  .map(model => window.requestAnimationFrame(R.curryN(2, render)(model)))

flyd.on
    ( model => (actions() && actions().replicate) ? saved_models(model) : null
    , model
    )

flyd.on(saveState, saved_models)
//if (and only if) `actions` volume gets too high, should we throttle saveState


const incomingExternalActions$ = 
  forwardTo
    ( actions
    , action => 
         log('incomingExternalActions$: ', { ...action, replicate: false})
    )

const outgoingExternalActions$ = filter(R.prop('replicate'), actions)

///// External listeners
window.addEventListener('storage', e => {
  if (e.key !== STORAGE_CHANNEL)
        return
  try {
    const contents = JSON.parse(e.newValue)
    console.log('event from channel: ', contents)

    // "The StorageEvent is fired whenever a change is made to the Storage
    // object (note that this event is not fired for sessionStorage changes).
    // This won't work on the same page that is making the changes — it is
    // really a way for other pages on the domain using the storage to sync any
    // changes that are made."
    //
    // From https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API
    // (Accessed April 14, 2018)

    contents.replicate = false
    incomingExternalActions$(contents)
  }
  catch(e) {
    console.error(e)
  }
})


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

flyd.on
  ( a => localStorage.setItem(STORAGE_CHANNEL, log('sending action: ', JSON.stringify(a)) ) 
  , outgoingExternalActions$
  )


export default ({init, initial_actions, model, update, render, reorder_feed_source})

