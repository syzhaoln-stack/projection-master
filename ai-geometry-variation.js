import * as THREE from 'three';

export const GEOMETRY_VARIATION_PARAMETERS = Object.freeze([
  { key: 'lengthPercent', label: '纵向整体比例', value: 100, min: 50, max: 150, step: 1, unit: '%' },
  { key: 'widthPercent', label: '横向整体比例', value: 100, min: 50, max: 150, step: 1, unit: '%' },
  { key: 'heightPercent', label: '竖向整体比例', value: 100, min: 50, max: 150, step: 1, unit: '%' }
].map(Object.freeze));

const DEFINITIONS = new Map(GEOMETRY_VARIATION_PARAMETERS.map(parameter => [parameter.key, parameter]));

function validatedValues(values) {
  if (values === null || typeof values !== 'object' || Array.isArray(values)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(values))) {
    throw new TypeError('几何变体参数必须是仅含整体比例的普通对象。');
  }
  const normalized = Object.fromEntries(GEOMETRY_VARIATION_PARAMETERS.map(({ key, value }) => [key, value]));
  for (const key of Reflect.ownKeys(values)) {
    const definition = DEFINITIONS.get(key);
    if (!definition) throw new TypeError(`不支持的几何变体参数：${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(values, key);
    if (!Object.hasOwn(descriptor, 'value') || !Number.isFinite(descriptor.value)) {
      throw new TypeError(`${key} 必须是有限数字。`);
    }
    if (descriptor.value < definition.min || descriptor.value > definition.max) {
      throw new RangeError(`${key} 必须在 ${definition.min}%～${definition.max}% 之间。`);
    }
    normalized[key] = descriptor.value;
  }
  return normalized;
}

/** Scale points already expressed in the platform's model coordinates: X / up-Y / width-Z. */
export function geometryVariationVector(values = {}) {
  const { lengthPercent, widthPercent, heightPercent } = validatedValues(values);
  return [lengthPercent / 100, heightPercent / 100, widthPercent / 100];
}

/** Wrap a source model; build a fresh source model for each independent variant. */
export function applyGeometryVariation(model, values = {}) {
  const normalized = validatedValues(values);
  if (!(model instanceof THREE.Object3D) || model.isCamera) {
    throw new TypeError('几何变体需要 THREE.Object3D 模型，不能使用相机。');
  }
  const scale = [normalized.lengthPercent / 100, normalized.heightPercent / 100, normalized.widthPercent / 100];
  if (scale.every(value => value === 1)) return model;

  const wrapper = new THREE.Group();
  wrapper.name = 'teaching-geometry-variation';
  wrapper.scale.fromArray(scale);
  wrapper.userData = {
    label: '教学整体几何变体',
    geometryVariation: {
      type: 'teaching-whole-model-scale',
      parameters: { ...normalized },
      scale: [...scale],
      axes: { x: 'longitudinal', y: 'vertical', z: 'transverse' },
      sourceDimensions: 'reference-only',
      structuralDesign: false,
      note: '教学整体几何变体：对全体构件整体缩放，不独立修改桥面宽或塔高；原模型源尺寸仅作对照，不用于结构设计。'
    }
  };

  // Inserting a wrapper retains the source model's local geometry and transforms.
  const parent = model.parent;
  const siblingIndex = parent?.children.indexOf(model);
  wrapper.add(model);
  if (parent) {
    parent.add(wrapper);
    parent.children.splice(parent.children.indexOf(wrapper), 1);
    parent.children.splice(siblingIndex, 0, wrapper);
  }
  wrapper.updateWorldMatrix(true, true);
  return wrapper;
}
