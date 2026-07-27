export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Quat {
  w: number
  x: number
  y: number
  z: number
}

export interface Pose3 {
  translation: Vec3
  rotation: Quat
}

export interface Tag {
  id: number
  pose: Pose3
  size: number
}

export interface TagLayout {
  field: {
    length: number
    width: number
  }
  tags: Tag[]
}

export interface CameraSpec {
  name: string
  hfovDeg: number
  vfovDeg: number
  resWidth: number
  resHeight: number
  maxRangeM: number | null
  mount: {
    x: number
    y: number
    z: number
    rollDeg: number
    pitchDeg: number
    yawDeg: number
  }
}

export interface OccluderBox {
  center: Vec3
  size: Vec3
  yawDeg: number
}

export interface RobotConfig {
  lengthM: number
  widthM: number
  chassisHeightM: number
  teamNumber: string
  superstructure: OccluderBox[]
  cameras: CameraSpec[]
}

export interface SimConfig {
  fieldYear: string
  robot: RobotConfig
}

export interface RobotPose {
  x: number
  y: number
  headingRad: number
}
