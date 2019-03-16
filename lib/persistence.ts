import {Model, init} from './model.ts'
import flyd from 'flyd'

/******* Some debugging tools *********/
// const reset_storage = () => localStorage.setItem(STORAGE_DB, JSON.stringify(init()))

/******** App constants ******/
const STORAGE_DB = 'state-rss'


class Persistence {
    constructor(saved_model_stream: flyd.Stream<Model>) {

      flyd.on(this.saveState, saved_model_stream)
    }
    restoreState (): Model {
      try {
        const restored = JSON.parse(localStorage.getItem(STORAGE_DB) || "null")
        return restored === null ? init() : restored
      }
      catch (e) {
        return init()
      }
    }
    private saveState (model: Model) {
      console.log('saving model: ', model)
      localStorage.setItem(STORAGE_DB, JSON.stringify(model))
    }
}


export default Persistence
