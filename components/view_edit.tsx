import flyd from 'flyd'

import {Action} from '../lib/action'
import {Model} from '../lib/model'

const ViewEdit: React.SFC<{model: Model, actions: flyd.Stream<Action>}> = ({model, actions}) =>
  <main>
    { model.source_categories.map(cat => 
        <article><h2>{cat.name}</h2>
        { model.sources
            .filter(s => s.category_id === cat.id)
            .map(s => <p>{s.url}</p>) }
        </article>
    )}
  </main>
export default ViewEdit
