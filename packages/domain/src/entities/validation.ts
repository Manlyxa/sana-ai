/** Единый формат ошибок валидации сущностей. */
export type ValidationError = {
  readonly field: string;
  readonly message: string;
};

export function invalid(field: string, message: string): ValidationError {
  return { field, message };
}
