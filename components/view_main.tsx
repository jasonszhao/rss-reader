import * as R from 'ramda'
import { DateTime } from 'luxon'
import URI from 'urijs'
import DOMPurify from 'dompurify'
import Parser from 'rss-parser'

import { Model } from '../lib/model'

// adapted from https://stackoverflow.com/a/47140708/
const strip_html = (html: string) => {
  var doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent || ""
}

const ViewArticle: React.SFC<{model: Model, source: Parser.Output, article: Parser.Item}> 
                          = ({model, source, article}) => {
  const link = article.permalink || article.link
  const date = DateTime.fromISO(article.isoDate || '').toLocaleString({ 
        month: "short", year: "numeric", day: 'numeric'
      })

  return <article key={article.id}>
    <h1>{ strip_html(article.title || '') }</h1>
    <div>
      { strip_html(source.title || '') } 
      {" "} (<a href={link}>{ (new URI(link)).hostname() }</a>) 
      {" "} { date }
    </div>
    <div className="summary" 
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(article.summary && article.summary._ || article.content || '')}}>
    </div>
  </article>
}
  
const ViewMain: React.SFC<{model: Model}> = ({model}) => 
  <main>
    {
      R.pipe
        ( R.chain((source: Parser.Output) => (source.items || []).map(a => ({
              data: a,
              view: <ViewArticle model={model} source={source} article={a} key={a.link || a.guid}/>
          })))
        , R.sort( (a, b) => 
            new Date(a.data.isoDate || '') < new Date(b.data.isoDate || '') ? 1 : -1)
        , R.map(R.prop("view"))

        ) (Object.values(model.cached_sources))
    }
    <p className="footer"> 
      That's it for now. Take a deep breath and enjoy some fresh air outside.
    </p>
  </main>

export default ViewMain
