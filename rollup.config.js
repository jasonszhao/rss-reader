import babel from 'rollup-plugin-babel'
import commonjs from 'rollup-plugin-commonjs'
import resolve from 'rollup-plugin-node-resolve'
import replace from 'rollup-plugin-replace'
import alias from 'rollup-plugin-alias'


export default {
  input: 'src/reader.jsx',
  output: {
    file: 'dist/reader.js',
    format: 'umd',
    name: 'reader'
  },
  plugins: [

    //allow loading third-party modules from node_modules
    resolve({
      browser: true 
    }),

    //allow importing CommonJS modules. 
    //For the CommonJS dependencies in node_modules
    commonjs(),

    //allow use of Inferno in the browser. The application will complain that
    //`process` doesn't exist without this plugin setting. 
    replace({
      'process.env.NODE_ENV': JSON.stringify('development'),
    }),

    //use the development version of Inferno
    alias({
      'inferno': __dirname + '/node_modules/inferno/dist/index.dev.esm.js'
    }),

    //call Babel from Rollup. This instance of Babel will still use .babelrc
    babel({
      exclude: 'node_modules/**'
    })
  ]
}

