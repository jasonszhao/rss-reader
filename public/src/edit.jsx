import * as Inferno from 'inferno'

const ViewEdit = ({model}) =>
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

// export default ({model}) => <p>hello</p>
