import * as R from 'ramda'
import flyd from 'flyd'
import Parser from 'rss-parser'
import produce from 'immer'

import { Model } from './model'
import { uuid } from './utils'

/**
 * An Action is a description of a model change.
 */
export interface Action {
  timestamp: string // when this action was initiated
  uuid: string
  replicate: boolean
  type: string
  [propName: string]: any
}


/*********************
 * Action Generators: functions that return actions
 *********************/ 
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
  uuid: uuid(),
  replicate: true
})

export const request_feed = (url: string) => ({
  ...base_action(),
  type: REQUEST_FEED,
  url,
  replicate: false
})
export const request_feed_return = (url: string, status: number, data: Parser.Output) => ({
  ...base_action(),
  type: REQUEST_FEED_RETURN,
  url,
  status,
  data,
  replicate: false
})

export const add_feed_source = (url: string, category_id: string) => ({
  ...base_action(),
  type: ADD_FEED_SOURCE,
  source_id: uuid(),
  url,
  category_id: category_id || '32l342lkj',
  replicate: true
})

export const update_feed_source = (id: string, url: string, category_id: string) => ({
  ...base_action(),
  type: UPDATE_FEED_SOURCE,
  source_id: id,
  url,
  category_id: category_id,
  replicate: true
})

export const remove_feed_source = (id: string) => ({
  ...base_action(),
  type: REMOVE_FEED_SOURCE,
  source_id: id,
  replicate: true
})

export const reorder_feed_source = (source_id: string, place: number) => ({
  ...base_action(),
  type: REORDER_FEED_SOURCE,
  source_id,
  place,
  replicate: true
})


/**
 * An Updater is a function that takes a model and returns a returns a model. 
 */
export type Updater = (model: Model) => Model
/**
 *********************
 *  Action -> Updater
 *********************
 * 
 * We want both getting the updater and applying the updater function to be 
 * somewhat free of side effects. This is because we anticipate doing those things
 * multiple times at different parts of the application that require us to turn a description
 * of a change into a change. 
 */
export const get_updater: (action: Action) => Updater
  = (() => (action: Action) => {
  const sink: flyd.Stream<Action> = flyd.stream()
  return get_updater_with_actions(action)(sink)
})()

const parser = new Parser({ customFields: { item: ['summary'] } })

export const get_updater_with_actions = (action: Action) => (actions: flyd.Stream<Action>): Updater => {
  switch (action.type) {
    case REQUEST_FEED:
      return produce(_ => {
        parser.parseURL("https://cors-anywhere.herokuapp.com/" + action.url)
            .then(data => actions(request_feed_return(action.url, 200, data)))
      })

    case REQUEST_FEED_RETURN:
      if (action.status === 200)
        return produce(d => {
          d.cached_sources[uuid()] = action.data
        })
      else
        return R.identity

    case ADD_FEED_SOURCE:
      return produce(d => {
        d.sources.push({
          url: action.url,
          category_id: action.category_id,
          id: action.source_id
        })
      })
    case REMOVE_FEED_SOURCE:
      return produce(d => {
        d.sources = R.reject(source => action.source_id === source.id, d.sources)
      })
    case UPDATE_FEED_SOURCE:
      return produce(d => {
        d.sources = d.sources.map(source =>
          source.id === action.source_id
            ? {
              ...source,
              url: action.url || source.url,
              category_id: action.category_id || source.category_id
            }
            : source
        )
      })
    case REORDER_FEED_SOURCE:
      //reorder a feed source within its category
      return produce(d => {

        const original_index =
          d.sources.findIndex(s => s.id === action.source_id)

        //remove the item from the sources list
        const [source] = d.sources.splice(original_index, 1)

        //iterate through the remaining list until we find the target_place
        let target_place = 0
        for (let i = 0; i < d.sources.length; i++) {
          if (d.sources[i].category_id === source.category_id)
            target_place++

          if (target_place === action.place) {
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
      return R.identity
  }
}

export const update: ((action: Action, model: Model) => Model) = R.uncurryN(2, get_updater)
