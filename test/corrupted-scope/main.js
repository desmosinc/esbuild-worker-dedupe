/* eslint-env browser */
import "create-worker";
import { a } from "./shared";
import "./write-global";

window.result = a;
window.__testLoaded = true;
