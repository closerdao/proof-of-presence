import {type Accounts, type Data, type Extensions, extensions} from './config.js';
import {setupDeployScripts} from 'rocketh';
import * as artifacts from '../generated/artifacts/index.js';

const {deployScript} = setupDeployScripts<Extensions, Accounts, Data>(extensions);

export {deployScript, artifacts};
