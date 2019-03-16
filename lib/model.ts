import Parser from 'rss-parser'

interface SourceCategory {
  name: string
  id: string
}
export interface Source {
  url: string
  category_id: string
  id: string
}

// export interface ReturnArticle {
//   source_id: string
//   source: string
//   title: string
//   summary: string
//   permalink: string
//   id: string
//   date: string
//   link: string
// }
// export interface ReturnSource {
//   articles: ReturnArticle[]
//   meta: any
// }
export interface Model {
  source_categories: SourceCategory[]
  sources: Array<Source>
  cached_sources: {
    [propName: string]: Parser.Output
  }
  cached_articles: Parser.Item[]
}


export const init: () => Model = () => ({
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
