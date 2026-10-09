import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('dist/server', {recursive:true});
copyFileSync('worker.js', 'dist/server/index.js');
console.log('Worker build ready');
