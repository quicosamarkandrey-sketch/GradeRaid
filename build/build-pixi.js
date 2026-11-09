const esbuild=require('esbuild'),fs=require('node:fs');
esbuild.buildSync({entryPoints:['build/pixi-runtime-entry.js'],bundle:true,minify:true,format:'iife',target:'es2020',outfile:'assets/vendor/pixi-runtime.min.js',legalComments:'eof'});
fs.copyFileSync('node_modules/pixi.js/LICENSE','assets/vendor/PIXI-LICENSE.txt');
