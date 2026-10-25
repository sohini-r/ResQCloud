export function findVolunteerProfile(volunteers, user) {
  if (!user?.id) return null
  return volunteers.find((volunteer) => volunteer.userId === user.id) || null
}

export function findAssignedShelter(shelters, user) {
  if (!user?.id) return null
  return shelters.find((shelter) => shelter.managerId === user.id) || null
}

export function canManageShelter(user, shelter) {
  return Boolean(
    shelter &&
    (user?.role === 'Authority Administrator' ||
      (user?.role === 'Shelter Manager' && user.id && shelter.managerId === user.id))
  )
}

export function isShelterManagerAssignmentValid(users, shelters, managerId, currentShelterId) {
  if (!managerId) return true
  if (shelters.some((shelter) => shelter.id === currentShelterId && shelter.managerId === managerId)) return true
  const managerExists = users.some((user) => user.id === managerId && user.role === 'Shelter Manager')
  const assignedElsewhere = shelters.some((shelter) => shelter.id !== currentShelterId && shelter.managerId === managerId)
  return managerExists && !assignedElsewhere
}

export function canManageVolunteerProfile(user, volunteer) {
  return Boolean(
    volunteer &&
    (user?.role === 'Authority Administrator' ||
      (user?.role === 'Volunteer' && user.id && volunteer.userId === user.id))
  )
}

export function isOwnedByUser(record, ownerKey, user) {
  return Boolean(user?.id && record?.[ownerKey] === user.id)
}

export async function prepareIncidentUpdate(incident, changes, persistStatus) {
  if (changes.status && changes.status !== incident.status) {
    const persistedIncident = await persistStatus(incident.id, changes.status)
    return { ...incident, ...persistedIncident, ...changes, status: persistedIncident.status }
  }
  return { ...incident, ...changes }
}

export function isAlertReadByUser(alert, user) {
  if (!alert) return true
  if (!user?.id) return Boolean(alert.read)
  if (Array.isArray(alert.readBy)) return alert.readBy.includes(user.id)
  return Boolean(alert.read)
}

export function getGlobalSearchPath(role) {
  return role === 'Authority Administrator' ? '/incidents' : '/map'
}

export function createRecordId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}
