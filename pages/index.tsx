import * as R from 'ramda'
import filter from 'flyd/module/filter'
import flyd from 'flyd'
import Head from 'next/head'
import React from 'react'

import { Action, request_feed, update, get_updater_with_actions} from '../lib/action'
import { Model, init } from '../lib/model'
import LocalStorageExternalActionsDriver from '../lib/external_action_driver'
import Persistence from '../lib/persistence'
import ViewMain from '../components/view_main'

class App extends React.Component {
  actions: flyd.Stream<Action> = flyd.stream()
  model: flyd.Stream<Model>

  state: Model

  constructor(props: Readonly<{}>) {
    super(props)

    if (typeof localStorage !== 'undefined') {
      new LocalStorageExternalActionsDriver(this.actions)

      // we have three references in a circle
      const models_to_save: flyd.Stream<Model> = flyd.stream() 
      const persistence = new Persistence(models_to_save)
      this.model = flyd.scan(R.flip(update), persistence.restoreState(), this.actions)

      const new_models_to_save = filter(_ => this.actions() && this.actions().replicate, this.model)
      flyd.on(models_to_save as ((_: Model) => void), new_models_to_save)
    } else {
      this.model = flyd.scan(R.flip(update), init(), this.actions)
    }
    
    this.state = this.model()
  }
  componentDidMount() {
    // rerender view on model change
    const updates = this.actions.map((action) => get_updater_with_actions(action)(this.actions))
    updates.map(u => this.setState(u))

    // get feeds of sources
    const initial_actions: Action[] = this.model().sources.map(source => request_feed(source.url))
    initial_actions.forEach((a: Action) => this.actions(a))
  }
  render() {
    return (
      <div>
        <Head>
          <link href="/static/style.css" rel="stylesheet" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </Head>
        <header>
          <span className="logo"> RSS Reader </span>
          <span className="greeting">
            Good Afternoon, <strong>savvy internet user</strong>!
          </span>
          <a className="right" href="/edit/feeds">Edit Feeds</a>
        </header>
        <ViewMain model={this.state} />
      </div>)
    }
  }
// export default ({init, initial_actions, model, update, render, reorder_feed_source})
export default App
