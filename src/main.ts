import { SharedThing } from "./shared";

import {createWorker} from 'inlined-worker!./worker'

console.log('main', new SharedThing().id);

createWorker();