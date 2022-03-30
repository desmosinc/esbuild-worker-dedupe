import { SharedThing } from "./shared";
// const { SharedThing } = require('./shared');

import {createWorker} from 'create-worker'

console.log('main', new SharedThing().id);

createWorker();