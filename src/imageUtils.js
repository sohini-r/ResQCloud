export const MAX_INCIDENT_IMAGE_INPUT_BYTES = 10 * 1024 * 1024
export const MAX_INCIDENT_IMAGE_STORAGE_BYTES = 700 * 1024

export function getIncidentImageValidationError(file) {
  if (!file.type.startsWith('image/')) return 'Choose a valid image file.'
  if (file.size > MAX_INCIDENT_IMAGE_INPUT_BYTES) return 'Choose an image smaller than 10 MB.'
  return ''
}
