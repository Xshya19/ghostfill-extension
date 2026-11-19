import { parentPort, workerData } from 'node:worker_threads';

import {
  createInitialParams,
  createKernelScratch,
  type EncodedSample,
  forwardBackwardSample,
  packGradsFlat,
  unpackParamsFlat,
  zeroAllGrads,
} from './neuralKernel';

interface WorkerInit {
  shard: EncodedSample[];
}

interface WorkerBatchMsg {
  type: 'grad_batch' | 'eval_shard';
  weights: Float32Array;
  indices: Int32Array;
  lossWeights: { otp: number; link: number; action: number };
}

const init = workerData as WorkerInit;
const shard = init.shard;
const params = createInitialParams(1);
const scratch = createKernelScratch();
let gradOutBuf: Float32Array | undefined;

parentPort?.on('message', (msg: WorkerBatchMsg) => {
  unpackParamsFlat(params, msg.weights);
  if (msg.type === 'grad_batch') {
    zeroAllGrads(params);
    let lossSum = 0;
    let iOk = 0;
    let oChk = 0;
    let oOk = 0;
    let lChk = 0;
    let lOk = 0;
    let aOk = 0;
    let falseAuto = 0;

    const idxs = msg.indices;
    for (let i = 0; i < idxs.length; i++) {
      const stats = forwardBackwardSample(shard[idxs[i]!]!, params, scratch, true, msg.lossWeights);
      lossSum += stats.loss;
      if (stats.intentCorrect) {
        iOk += 1;
      }
      if (stats.otpChecked) {
        oChk += 1;
        if (stats.otpCorrect) {
          oOk += 1;
        }
      }
      if (stats.linkChecked) {
        lChk += 1;
        if (stats.linkCorrect) {
          lOk += 1;
        }
      }
      if (stats.actionCorrect) {
        aOk += 1;
      }
      if (stats.falseAutoAct) {
        falseAuto += 1;
      }
    }

    gradOutBuf = packGradsFlat(params, gradOutBuf);
    const sendCopy = gradOutBuf.slice();
    parentPort!.postMessage(
      {
        grads: sendCopy,
        count: idxs.length,
        lossSum,
        iOk,
        oChk,
        oOk,
        lChk,
        lOk,
        aOk,
        falseAuto,
      },
      [sendCopy.buffer]
    );
  } else if (msg.type === 'eval_shard') {
    let lossSum = 0;
    let iOk = 0;
    let oChk = 0;
    let oOk = 0;
    let lChk = 0;
    let lOk = 0;
    let aOk = 0;
    let falseAuto = 0;
    for (let i = 0; i < shard.length; i++) {
      const stats = forwardBackwardSample(shard[i]!, params, scratch, false, msg.lossWeights);
      lossSum += stats.loss;
      if (stats.intentCorrect) {
        iOk += 1;
      }
      if (stats.otpChecked) {
        oChk += 1;
        if (stats.otpCorrect) {
          oOk += 1;
        }
      }
      if (stats.linkChecked) {
        lChk += 1;
        if (stats.linkCorrect) {
          lOk += 1;
        }
      }
      if (stats.actionCorrect) {
        aOk += 1;
      }
      if (stats.falseAutoAct) {
        falseAuto += 1;
      }
    }
    parentPort!.postMessage({
      count: shard.length,
      lossSum,
      iOk,
      oChk,
      oOk,
      lChk,
      lOk,
      aOk,
      falseAuto,
    });
  }
});
