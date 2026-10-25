import test from 'node:test'
import assert from 'node:assert/strict'
import { getIncidentImageValidationError, MAX_INCIDENT_IMAGE_INPUT_BYTES, MAX_INCIDENT_IMAGE_STORAGE_BYTES } from '../src/imageUtils.js'
import {
  createRecordId,
  canManageShelter,
  canManageVolunteerProfile,
  findAssignedShelter,
  findVolunteerProfile,
  getGlobalSearchPath,
  isAlertReadByUser,
  isOwnedByUser,
  isShelterManagerAssignmentValid,
  prepareIncidentUpdate,
} from '../src/stateUtils.js'

test('volunteer profile lookup only associates profiles by stable user ID', () => {
  const volunteers = [
    { id: 'VOL-1', userId: 'USR-1', name: 'Alex', tasks: ['private task'] },
    { id: 'VOL-2', userId: 'USR-2', name: 'Jordan', tasks: [] },
  ]

  assert.equal(findVolunteerProfile(volunteers, { id: 'USR-2', name: 'Alex' }).id, 'VOL-2')
  assert.equal(findVolunteerProfile(volunteers, { id: 'USR-3', name: 'Alex' }), null)
  assert.equal(findVolunteerProfile(volunteers, { name: 'Alex' }), null)
  assert.equal(canManageVolunteerProfile({ id: 'USR-2', role: 'Volunteer' }, volunteers[0]), false)
  assert.equal(canManageVolunteerProfile({ id: 'USR-2', role: 'Volunteer' }, volunteers[1]), true)
})

test('shelter assignment only matches a manager ID and never defaults to the first shelter', () => {
  const shelters = [
    { id: 'SH-1', manager: 'Alex', managerId: 'USR-1' },
    { id: 'SH-2', manager: 'Jordan', managerId: 'USR-2' },
  ]

  assert.equal(findAssignedShelter(shelters, { id: 'USR-2', name: 'Alex' }).id, 'SH-2')
  assert.equal(findAssignedShelter(shelters, { id: 'USR-3', name: 'Alex' }), null)
  assert.equal(canManageShelter({ id: 'USR-3', role: 'Shelter Manager' }, shelters[0]), false)
  assert.equal(canManageShelter({ id: 'USR-1', role: 'Shelter Manager' }, shelters[0]), true)
  assert.equal(canManageShelter({ role: 'Authority Administrator' }, shelters[1]), true)
})

test('a shelter manager can only be assigned to one shelter by an administrator', () => {
  const users = [{ id: 'USR-1', role: 'Shelter Manager' }, { id: 'USR-2', role: 'Citizen' }]
  const shelters = [{ id: 'SH-1', managerId: 'USR-1' }]
  const legacyShelters = [{ id: 'SH-old', managerId: 'USR-legacy' }]

  assert.equal(isShelterManagerAssignmentValid(users, shelters, '', 'SH-2'), true)
  assert.equal(isShelterManagerAssignmentValid(users, shelters, 'USR-1', 'SH-2'), false)
  assert.equal(isShelterManagerAssignmentValid(users, shelters, 'USR-1', 'SH-1'), true)
  assert.equal(isShelterManagerAssignmentValid(users, shelters, 'USR-2', 'SH-2'), false)
  assert.equal(isShelterManagerAssignmentValid(users, legacyShelters, 'USR-legacy', 'SH-old'), true)
})

test('citizen record ownership is determined by user ID rather than display name', () => {
  const record = { reporter: 'Alex', reporterId: 'USR-1' }

  assert.equal(isOwnedByUser(record, 'reporterId', { id: 'USR-1', name: 'Changed Name' }), true)
  assert.equal(isOwnedByUser({ reporter: 'Alex' }, 'reporterId', { id: 'USR-1', name: 'Alex' }), false)
  assert.equal(isOwnedByUser(record, 'reporterId', { id: 'USR-2', name: 'Alex' }), false)
})

test('a failed incident status save does not produce changed frontend incident state', async () => {
  const incident = { id: 'incident-1', status: 'Reported', description: 'Original record' }
  const before = { ...incident }

  await assert.rejects(
    prepareIncidentUpdate(incident, { status: 'Verified' }, async () => {
      throw new Error('Backend update failed')
    }),
    /Backend update failed/,
  )

  assert.deepEqual(incident, before)
})

test('global search only opens the authority incident queue for authority users', () => {
  assert.equal(getGlobalSearchPath('Authority Administrator'), '/incidents')
  for (const role of ['Citizen', 'Volunteer', 'Shelter Manager']) {
    assert.equal(getGlobalSearchPath(role), '/map')
  }
})

test('notification read status is specific to the current user', () => {
  const alert = { read: true, readBy: ['USR-1'] }

  assert.equal(isAlertReadByUser(alert, { id: 'USR-1' }), true)
  assert.equal(isAlertReadByUser(alert, { id: 'USR-2' }), false)
  assert.equal(isAlertReadByUser({ read: false, readBy: [] }, { id: 'USR-1' }), false)
})

test('record IDs retain the full timestamp and a random suffix', () => {
  assert.match(createRecordId('VOL'), /^VOL-[a-z0-9]+-[a-z0-9]{1,7}$/)
})

test('incident evidence input validation rejects non-images and oversized files', () => {
  assert.equal(getIncidentImageValidationError({ type: 'text/plain', size: 10 }), 'Choose a valid image file.')
  assert.equal(getIncidentImageValidationError({ type: 'image/jpeg', size: MAX_INCIDENT_IMAGE_INPUT_BYTES + 1 }), 'Choose an image smaller than 10 MB.')
  assert.equal(getIncidentImageValidationError({ type: 'image/jpeg', size: MAX_INCIDENT_IMAGE_INPUT_BYTES }), '')
  assert.equal(MAX_INCIDENT_IMAGE_STORAGE_BYTES, 700 * 1024)
})
