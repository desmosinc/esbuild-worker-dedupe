import { SharedThing } from "./shared";
// const { SharedThing } = require('./shared');

import {createWorker} from 'inlined-worker!./worker'

console.log('main', new SharedThing().id);

createWorker();