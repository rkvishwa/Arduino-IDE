const { spawn } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const electronBinary = require('electron');

const child = spawn(electronBinary, ['.'], {
  cwd: projectRoot,
  detached: true,
  stdio: 'ignore',
});

child.unref();

console.log('Tantalum IDE launched in the background.');
