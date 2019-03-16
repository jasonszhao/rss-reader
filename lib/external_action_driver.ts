/**
 * Connects an Action stream with an external Action communication channel.
 * So far, we only use localStorage.
 */

import flyd from 'flyd'
import filter from 'flyd/module/filter'
import forwardTo from 'flyd/module/forwardto'
import { prop } from 'ramda'

import { Action } from './action'
import { log } from './utils'

const STORAGE_CHANNEL = 'channel-rss'

export class ExternalActionsDriver {
  constructor(actions: flyd.Stream<Action>) {

    //if (and only if) `actions` volume gets too high, should we throttle saveState
    const incomingExternalActions$: flyd.Stream<Action> =
      forwardTo
        ( actions
        , action => log('incomingExternalActions$: ', { ...action, replicate: false }))

    const outgoingExternalActions$: flyd.Stream<Action> = filter(prop('replicate'), actions)
    
    this.relayIncomingActionsTo(incomingExternalActions$)
    this.relayOutgoingActionsFrom(outgoingExternalActions$)
  }

  private relayOutgoingActionsFrom(outgoingExternalActions$: flyd.Stream<Action>) {

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
      (a => localStorage.setItem(STORAGE_CHANNEL, log('sending action: ', JSON.stringify(a)))
        , outgoingExternalActions$
      )
  }

  private relayIncomingActionsTo(incomingExternalActions$: flyd.Stream<Action>) {
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', e => {
        if (e.key !== STORAGE_CHANNEL)
          return
        try {
          const contents = JSON.parse(e.newValue || 'null')
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
        catch (e) {
          console.error(e)
        }
      })
    }
  }
}
