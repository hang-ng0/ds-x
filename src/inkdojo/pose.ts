import { PoseLandmarker } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import type { PoseModel } from './settings'

// MediaPipe pose landmark indices (33 in total)
export const P = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const

export const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS

// Self-hosted so nothing is fetched from Google at runtime
const modelPath = (model: PoseModel) => `${import.meta.env.BASE_URL}models/pose_landmarker_${model}.task`

export async function createPoseLandmarker(model: PoseModel) {
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: modelPath(model), delegate },
    runningMode: 'VIDEO' as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  })
  const fileset = { wasmLoaderPath, wasmBinaryPath }
  try {
    return await PoseLandmarker.createFromOptions(fileset, options('GPU'))
  } catch {
    return PoseLandmarker.createFromOptions(fileset, options('CPU'))
  }
}
