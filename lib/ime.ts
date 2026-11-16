export interface ImeKeyboardEventLike {
  isComposing?: boolean;
  keyCode?: number;
}

/**
 * Enter 是否仍属于 IME 候选词确认。
 * keyCode 229 覆盖 Safari 在 compositionend 与确认 Enter 之间的乱序投递。
 */
export function isImeConfirmingKey(event: ImeKeyboardEventLike): boolean {
  return event.isComposing === true || event.keyCode === 229;
}
