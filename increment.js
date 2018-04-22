"use strict";

/******** App constants ******/
const DEBUG = true
const STORAGE_DB = 'state'
const STORAGE_CHANNEL = 'channel'


/***** Some "functional" utilities ****/
const produce = immer.default.bind(immer)

//console.logs args and returns the last one
//This can be a bottleneck if we're logging ~1000 items at once. 
//How do I know? I've tested this function with and without side effects
//With log: lag with a few seconds. Without console.log: instantaneous
const log = (...args) => 
    ( DEBUG ? console.log.apply(console, args) : null
    , args[args.length - 1]
    )

const uuid = () => (Math.random()+1).toString(36).slice(2) 

//pure, actually functional utilities
const add = R.curry((b, a) => a + b)
const subtract = R.curry((b, a) => a - b)

const add1 = add(1)
const subtract1 = subtract(1)
//////// END functional utilities

// Model
const init = () => ({
  x: 0,
  y: 0,
})


// Actions
const INCREMENT_X = 'increment_x'
const DECREMENT_X = 'decrement_x'
const INCREMENT_Y = 'increment_y'
const DECREMENT_Y = 'decrement_y'

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

const increment_x = () => ({
  ...base_action(),
  type: INCREMENT_X,
  replicate: false,
})
const decrement_x = () => ({
  ...base_action(),
  type: DECREMENT_X,
  replicate: false,
})
const increment_y = () => ({
  ...base_action(),
  type: INCREMENT_Y,
  replicate: true,
})
const decrement_y = () => ({
  ...base_action(),
  type: DECREMENT_Y,
  replicate: true,
})


function update(action, model) {
    switch (action.type) {
        case INCREMENT_X:
            return produce(model, d => {
                d.x += 1
            })
        case DECREMENT_X:
            return {
                x: model.x - 1,
                y: model.y
            }
        case INCREMENT_Y:
            return {
                ...model,
                y: model.y + 1
            }
        case DECREMENT_Y:
            return {
                ...model,
                y: model.y - 1
            }
        default:
            console.log('BAAD! action not matched!')
            console.log('action: ', action)
            console.log('model: ', model)
            return model
    }
}
const restoreState = () => {
    const restored = JSON.parse(localStorage.getItem('state'))
    return restored === null ? init() : restored
}
const saveState = (model) => {
  console.log('saving model: ', model)
  localStorage.setItem('state', JSON.stringify(model))
}


// View
const $x = document.getElementById('x')
const $y = document.getElementById('y')
const $sum = document.getElementById('sum')

function render(model) {
  $x.textContent = model.x
  $y.textContent = model.y
  $sum.textContent = model.x + model.y

  $x.style.backgroundColor = `hsl(${model.x * 10 % 360}, 100%, 50%)`
  $y.style.backgroundColor = `hsl(${model.y * 10 % 360}, 100%, 50%)`
  $sum.style.backgroundColor = `hsl(${(model.x + model.y) * 10 % 360}, 100%, 50%)`
}

// Streams
const actions = flyd.stream()
const saved_models = flyd.stream()

const model = flyd.scan(R.flip(update), restoreState(), actions)
actions
  .map(R.curryN(2, log)('action: '))
model
  .map(R.curryN(2,log)('rendering with model: '))
  .map(model => requestAnimationFrame(R.curryN(2, render)(model)))

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

