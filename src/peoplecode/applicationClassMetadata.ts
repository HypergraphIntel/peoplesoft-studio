import { PRIMITIVE_SIGNATURE_TYPE_IDS } from './format.js';

/** Primitive method signatures measured from complete PeopleTools captures.
 * See docs/APPLICATION_CLASS_SIGNATURES.md. These are not Function slots. */
export interface PrimitiveMethodSignature {
  nameOffset: number;
  slotOffset: number;
  parameterTypes: readonly string[];
  returnType?: string;
}

function primitiveTypeId(type: string): number {
  const id = PRIMITIVE_SIGNATURE_TYPE_IDS.get(type.toLowerCase());
  if (id === undefined) throw new Error(`Unsupported Application Class signature type: ${type}`);
  return id;
}

/** One public concrete method's directory record and its dispatch slots.
 * Name offsets count UTF-16 code units; slot offsets count four-byte slots.
 * Ordering records, properties, inheritance and object types are outside
 * this helper's scope. No Function parameter flags are added. */
export function encodePrimitiveMethodSignature(signature: PrimitiveMethodSignature): {
  record: Buffer;
  slots: Buffer;
} {
  for (const offset of [signature.nameOffset, signature.slotOffset]) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 0xffffffff) {
      throw new Error('Application Class signature offsets must be uint32 values');
    }
  }
  if (signature.parameterTypes.length > 0xffff) {
    throw new Error('Application Class parameter count exceeds the calibrated count field');
  }
  const record = Buffer.alloc(16);
  record.writeUInt32LE(signature.nameOffset, 0);
  record.writeUInt32LE(signature.slotOffset, 4);
  record.writeUInt32LE(signature.parameterTypes.length, 8);
  record.writeUInt32LE(signature.returnType === undefined ? 0x07 : primitiveTypeId(signature.returnType), 12);
  const slots = Buffer.alloc(4 * (signature.parameterTypes.length + 1));
  signature.parameterTypes.forEach((type, index) => slots.writeUInt32LE(primitiveTypeId(type), index * 4));
  slots.writeUInt32LE(0x07, signature.parameterTypes.length * 4);
  return { record, slots };
}
