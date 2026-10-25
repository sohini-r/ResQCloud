import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  emergencyHelplines,
  initialActivity,
  initialAlerts,
  initialAvailableVolunteerTasks,
  initialCitizenReliefRequests,
  initialDeliveryLogs,
  initialFieldReports,
  initialIncidents,
  initialOccupants,
  initialRescueRequests,
  initialResourceRequests,
  initialResources,
  initialShelterIssues,
  initialShelters,
  initialTransactions,
  initialUsers,
  initialVolunteers,
} from './data.js'
import {
  canManageShelter as userCanManageShelter,
  canManageVolunteerProfile,
  createRecordId,
  isAlertReadByUser,
  isShelterManagerAssignmentValid,
  isOwnedByUser,
  prepareIncidentUpdate,
} from './stateUtils.js'
import {
  clearAccessToken,
  approveApplication as approveApiApplication,
  createIncident as createApiIncident,
  fetchApplications as fetchApiApplications,
  fetchIncidents,
  loginAccount,
  rejectApplication as rejectApiApplication,
  registerAccount,
  setAccessToken,
  updateIncidentStatus as updateApiIncidentStatus,
} from './api.js'

const STORAGE_KEY = 'resqcloud-state-v1'
const AppContext = createContext(null)
const demoUsers = initialUsers.map(({ password: _password, ...user }) => user)

const initialState = {
  user: null,
  users: demoUsers,
  incidents: initialIncidents,
  applications: [],
  applicationsStatus: 'PENDING',
  applicationsLoading: false,
  applicationsError: '',
  incidentSource: 'demo',
  incidentError: '',
  rescueRequests: initialRescueRequests,
  citizenReliefRequests: initialCitizenReliefRequests,
  shelters: initialShelters,
  occupants: initialOccupants,
  shelterIssues: initialShelterIssues,
  resources: initialResources,
  resourceRequests: initialResourceRequests,
  volunteers: initialVolunteers,
  availableTasks: initialAvailableVolunteerTasks,
  fieldReports: initialFieldReports,
  deliveryLogs: initialDeliveryLogs,
  alerts: initialAlerts,
  transactions: initialTransactions,
  activity: initialActivity,
}

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      const normalizedUsers = (parsed.users?.length ? parsed.users : initialUsers).map((u) => ({
        ...Object.fromEntries(Object.entries(u).filter(([key]) => key !== 'password')),
        id: u.id || (u.email ? `USR-${btoa(u.email.toLowerCase()).replace(/=/g, '').slice(0, 8)}` : `USR-${Math.random().toString(36).slice(2, 8)}`),
      }))
      const normalizedAlerts = (parsed.alerts || initialAlerts).map((a) => ({
        ...a,
        readBy: Array.isArray(a.readBy) ? a.readBy : (a.read ? ['system'] : []),
      }))
      return {
        ...initialState,
        ...parsed,
        user: null,
        incidentSource: 'demo',
        incidentError: '',
        users: normalizedUsers,
        alerts: normalizedAlerts,
        rescueRequests: parsed.rescueRequests || initialRescueRequests,
        citizenReliefRequests: parsed.citizenReliefRequests || initialCitizenReliefRequests,
        occupants: parsed.occupants || initialOccupants,
        shelterIssues: parsed.shelterIssues || initialShelterIssues,
        availableTasks: parsed.availableTasks || initialAvailableVolunteerTasks,
        fieldReports: parsed.fieldReports || initialFieldReports,
        deliveryLogs: parsed.deliveryLogs || initialDeliveryLogs,
      }
    }
  } catch (error) {
    console.error('Unable to load ResQCloud data from local storage.', error)
  }
  return initialState
}

export function AppProvider({ children }) {
  const [state, setState] = useState(loadState)
  const [storageError, setStorageError] = useState('')

  useEffect(() => {
    try {
      const safeState = {
        ...state,
        user: null,
        users: state.users.map(({ password: _password, ...user }) => user),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safeState))
      setStorageError((current) => (current ? '' : current))
    } catch (error) {
      console.error('Unable to save ResQCloud data to local storage.', error)
      setStorageError('Browser storage is full or unavailable. Changes remain in this session only and may be lost after reload; free browser storage and try again.')
    }
  }, [state])

  useEffect(() => {
    const handleAuthenticationExpired = () => {
      setState((current) => ({
        ...current,
        user: null,
        incidents: initialIncidents,
        incidentSource: 'demo',
        incidentError: '',
      }))
    }
    window.addEventListener('resqcloud:authentication-expired', handleAuthenticationExpired)
    return () => window.removeEventListener('resqcloud:authentication-expired', handleAuthenticationExpired)
  }, [])

  const value = useMemo(() => {
    const update = (key, updater) => setState((current) => ({ ...current, [key]: updater(current[key]) }))
    const canManageShelter = (shelterId) => {
      return userCanManageShelter(state.user, state.shelters.find((shelter) => shelter.id === shelterId))
    }
    const canManageVolunteer = (volunteerId) => {
      const volunteer = state.volunteers.find((item) => item.id === volunteerId)
      return canManageVolunteerProfile(state.user, volunteer)
    }
    const log = (text, icon = 'activity', details = {}) => {
      const actorName = state.user?.name || 'System'
      const actorRole = state.user?.role || 'System'
      update('activity', (items) => [
        {
          id: `ACT-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`,
          text,
          icon,
          user: actorName,
          role: actorRole,
          at: new Date().toISOString(),
          ...details,
        },
        ...items,
      ].slice(0, 100))
    }

    const notify = (title, message, severity = 'Low', type = 'Incident', targetArea = null) => {
      update('alerts', (items) => [
        {
          id: `ALT-${Date.now().toString().slice(-5)}-${Math.floor(Math.random() * 1000)}`,
          title,
          message,
          severity,
          type,
          targetArea,
          at: new Date().toISOString(),
          readBy: [],
          read: false,
        },
        ...items,
      ])
    }

    const loadApplications = async (status = 'PENDING') => {
      setState((current) => ({ ...current, applicationsLoading: true, applicationsError: '' }))
      try {
        const applications = await fetchApiApplications(status)
        setState((current) => ({
          ...current,
          applications,
          applicationsStatus: status,
          applicationsLoading: false,
          applicationsError: '',
        }))
      } catch (error) {
        setState((current) => ({
          ...current,
          applications: [],
          applicationsStatus: status,
          applicationsLoading: false,
          applicationsError: error.message,
        }))
      }
    }

    const establishSession = async (session) => {
      setAccessToken(session.token)
      const user = session.user
      setState((current) => ({
        ...current,
        user,
        users: [user, ...current.users.filter((existing) => existing.id !== user.id)],
        incidents: [],
        incidentSource: 'loading',
        incidentError: '',
      }))

      try {
        const incidents = await fetchIncidents()
        setState((current) => ({
          ...current,
          incidents,
          incidentSource: 'database',
          incidentError: '',
        }))
      } catch (error) {
        if (error.status !== 401) {
          setState((current) => ({
            ...current,
            incidents: [],
            incidentSource: 'unavailable',
            incidentError: error.message,
          }))
        }
      }
      if (user.role === 'Authority Administrator') await loadApplications('PENDING')
      return user
    }

    const refreshIncidents = async () => {
      setState((current) => ({
        ...current,
        incidents: [],
        incidentSource: 'loading',
        incidentError: '',
      }))
      try {
        const incidents = await fetchIncidents()
        setState((current) => ({
          ...current,
          incidents,
          incidentSource: 'database',
          incidentError: '',
        }))
      } catch (error) {
        if (error.status !== 401) {
          setState((current) => ({
            ...current,
            incidents: [],
            incidentSource: 'unavailable',
            incidentError: error.message,
          }))
        }
      }
    }

    const updateIncident = async (id, changes) => {
      if (state.user?.role !== 'Authority Administrator') return false
      const incident = state.incidents.find((item) => item.id === id)
      if (!incident) return false
      const updatedIncident = await prepareIncidentUpdate(incident, changes, updateApiIncidentStatus)
      update('incidents', (items) => items.map((item) => (item.id === id ? updatedIncident : item)))
      if (changes.status && changes.status !== incident.status) {
        log(`${id} status changed to ${changes.status}`, 'check')
        notify(`Incident status updated — ${id}`, `Status changed to ${changes.status}${changes.rejectionReason ? `: ${changes.rejectionReason}` : '.'}`, 'Low', 'Incident')
      }
      if (changes.severity && changes.severity !== incident.severity) {
        log(`${id} severity changed to ${changes.severity}`, 'alert')
      }
      if (changes.team && changes.team !== incident.team) {
        log(`Team ${changes.team} assigned to ${id}`, 'truck')
        notify(`Response team assigned — ${id}`, `${changes.team} has been dispatched.`, 'Medium', 'Incident')
      }
      return true
    }

    return {
      ...state,
      storageError,
      emergencyHelplines,
      refreshIncidents,
      loadApplications,
      reviewApplication: async (applicationId, decision, reason) => {
        const application = decision === 'approve'
          ? await approveApiApplication(applicationId)
          : await rejectApiApplication(applicationId, reason)
        setState((current) => ({
          ...current,
          applications: current.applicationsStatus === application.accountStatus
            ? current.applications.map((item) => item.id === application.id ? application : item)
            : current.applications.filter((item) => item.id !== application.id),
        }))
        return application
      },

      // Authentication & Users
      login: async (email, password) => {
        const session = await loginAccount({ email, password })
        return establishSession(session)
      },
      registerUser: async (newUser) => {
        const result = await registerAccount({
          name: newUser.name.trim(),
          email: newUser.email.trim(),
          password: newUser.password,
          phone: newUser.phone?.trim() || undefined,
          address: newUser.address?.trim() || undefined,
          role: newUser.role,
        })
        if (result.application) return result.application
        return establishSession(result)
      },
      updateProfile: (details) => {
        setState((current) => {
          if (!current.user) return current
          const updatedUser = { ...current.user, ...details }
          const updatedUsers = current.users.map((u) => (u.id === current.user.id ? { ...u, ...details } : u))

          // Maintain ownership linkage if display name or contact changes
          const updatedIncidents = details.name
            ? current.incidents.map((inc) => (inc.reporterId === current.user.id ? { ...inc, reporter: details.name } : inc))
            : current.incidents
          const updatedRescue = details.name
            ? current.rescueRequests.map((req) => (req.citizenId === current.user.id ? { ...req, citizenName: details.name } : req))
            : current.rescueRequests
          const updatedRelief = details.name
            ? current.citizenReliefRequests.map((req) => (req.citizenId === current.user.id ? { ...req, citizenName: details.name } : req))
            : current.citizenReliefRequests
          const updatedVolunteers = current.volunteers.map((vol) =>
            vol.userId === current.user.id
              ? {
                  ...vol,
                  name: details.name || vol.name,
                  contact: details.phone || vol.contact,
                  area: details.address || vol.area,
                }
              : vol
          )
          const updatedShelters = details.name
            ? current.shelters.map((sh) => (sh.managerId === current.user.id ? { ...sh, manager: details.name } : sh))
            : current.shelters

          return {
            ...current,
            user: updatedUser,
            users: updatedUsers,
            incidents: updatedIncidents,
            rescueRequests: updatedRescue,
            citizenReliefRequests: updatedRelief,
            volunteers: updatedVolunteers,
            shelters: updatedShelters,
          }
        })
        log(`Profile updated for ${details.name || state.user?.name}`, 'settings')
      },
      logout: () => {
        clearAccessToken()
        setState((current) => ({
          ...current,
          user: null,
          incidents: initialIncidents,
          incidentSource: 'demo',
          incidentError: '',
        }))
      },
      resetData: () => {
        clearAccessToken()
        localStorage.removeItem(STORAGE_KEY)
        setState({ ...initialState })
      },

      // Incidents
      addIncident: async (incident) => {
        const item = await createApiIncident(incident)
        update('incidents', (items) => [item, ...items])
        log(`${item.type} report ${item.id} submitted at ${item.location}`, 'alert')
        notify(`New ${item.severity.toLowerCase()} incident report`, `${item.id} — ${item.location}`, item.severity, 'Incident')
        return item.id
      },
      updateIncident,
      rejectIncidentWithReason: async (id, reason) => {
        if (state.user?.role !== 'Authority Administrator') return false
        const incident = state.incidents.find((item) => item.id === id)
        if (!incident) return false
        const updated = await updateIncident(id, { status: 'Rejected', rejectionReason: reason })
        if (!updated) return false
        log(`Incident ${id} rejected. Reason: ${reason}`, 'alert')
        notify(`Incident report rejected — ${id}`, `Reason: ${reason}`, 'Medium', 'Incident')
        return true
      },
      cancelIncident: (id, reason = 'Cancelled by reporter') => {
        const incident = state.incidents.find((item) => item.id === id)
        if (
          !incident ||
          ['Resolved', 'Rejected'].includes(incident.status) ||
          (state.user?.role !== 'Authority Administrator' && !isOwnedByUser(incident, 'reporterId', state.user))
        ) return false
        update('incidents', (items) => items.map((item) => (item.id === id ? { ...item, status: 'Rejected', rejectionReason: reason } : item)))
        log(`Incident ${id} cancelled by reporter. Reason: ${reason}`, 'check')
        notify(`Report cancelled — ${id}`, `Cancelled: ${reason}`, 'Low', 'Incident')
        return true
      },

      // Rescue Requests (Citizen <-> Authority Admin)
      addRescueRequest: (req) => {
        const item = {
          ...req,
          id: createRecordId('RSC'),
          citizenId: state.user?.id,
          status: 'Pending',
          assignedTeam: null,
          reportedAt: new Date().toISOString(),
        }
        update('rescueRequests', (items) => [item, ...items])
        log(`Rescue request ${item.id} logged for ${item.location} (${item.peopleCount} people)`, 'alert')
        notify(`New rescue request: ${item.priority}`, `${item.id} at ${item.location} — ${item.peopleCount} people awaiting rescue.`, item.priority === 'Critical' ? 'Critical' : 'High', 'Incident')
        return item.id
      },
      updateRescueRequest: (id, changes) => {
        if (state.user?.role !== 'Authority Administrator') return false
        const req = state.rescueRequests.find((item) => item.id === id)
        if (!req) return false
        update('rescueRequests', (items) => items.map((item) => (item.id === id ? { ...item, ...changes } : item)))
        if (changes.status && changes.status !== req.status) {
          log(`Rescue request ${id} status updated to ${changes.status}`, 'check')
          notify(`Rescue request update — ${id}`, `Status updated to ${changes.status}${changes.assignedTeam ? ` (Team: ${changes.assignedTeam})` : ''}`, 'Medium', 'Incident')
        }
        return true
      },

      // Citizen Relief Requests (Food, Water, Medicines, Blankets)
      addCitizenReliefRequest: (req) => {
        const item = {
          ...req,
          id: createRecordId('REL'),
          citizenId: state.user?.id,
          status: 'Requested',
          requestedAt: new Date().toISOString(),
        }
        update('citizenReliefRequests', (items) => [item, ...items])
        log(`Relief supply request ${item.id} submitted by ${item.citizenName} for ${item.item} (${item.quantity})`, 'box')
        notify(`Relief supply request: ${item.item}`, `${item.quantity} units requested at ${item.location}. Urgency: ${item.urgency}`, item.urgency === 'High' ? 'High' : 'Medium', 'Resource')
        return item.id
      },
      updateCitizenReliefRequest: (id, status) => {
        if (state.user?.role !== 'Authority Administrator') return false
        const req = state.citizenReliefRequests.find((item) => item.id === id)
        if (!req) return false
        update('citizenReliefRequests', (items) => items.map((item) => (item.id === id ? { ...item, status } : item)))
        log(`Relief request ${id} updated to ${status}`, 'box')
        notify(`Relief request status update`, `${req.item} for ${req.citizenName} marked as ${status}.`, 'Low', 'Resource')
        return true
      },

      // Shelters
      addShelter: (shelter) => {
        if (state.user?.role !== 'Authority Administrator') return false
        if (!isShelterManagerAssignmentValid(state.users, state.shelters, shelter.managerId)) return false
        const manager = state.users.find((user) => user.id === shelter.managerId && user.role === 'Shelter Manager')
        const item = {
          ...shelter,
          id: createRecordId('SH'),
          managerId: manager?.id || '',
          manager: manager?.name || '',
        }
        update('shelters', (items) => [item, ...items])
        log(`Shelter ${item.name} added to response network`, 'home')
        return item.id
      },
      updateShelter: (id, changes) => {
        if (!canManageShelter(id)) return false
        const current = state.shelters.find((item) => item.id === id)
        if (!current) return false
        const safeChanges = { ...changes }
        delete safeChanges.id
        if (state.user?.role === 'Shelter Manager') {
          delete safeChanges.manager
          delete safeChanges.managerId
        } else if (
          Object.hasOwn(safeChanges, 'managerId') &&
          safeChanges.managerId !== current.managerId
        ) {
          const managerId = safeChanges.managerId || ''
          if (!isShelterManagerAssignmentValid(state.users, state.shelters, managerId, id)) return false
          const manager = state.users.find((user) => user.id === managerId && user.role === 'Shelter Manager')
          safeChanges.managerId = manager?.id || ''
          safeChanges.manager = manager?.name || ''
        }
        update('shelters', (items) => items.map((item) => (item.id === id ? { ...item, ...safeChanges } : item)))
        const shelter = { ...current, ...safeChanges }
        if (
          shelter &&
          shelter.status === 'Operational' &&
          shelter.capacity - shelter.occupancy <= shelter.capacity * 0.15 &&
          (!current || current.capacity - current.occupancy > current.capacity * 0.15)
        ) {
          notify('Shelter nearing capacity', `${shelter.name} has only ${shelter.capacity - shelter.occupancy} beds available.`, 'High', 'Shelter')
        }
        return true
      },

      // Shelter Occupants (Roster check-in/out and capacity validation)
      checkInOccupant: ({ shelterId, name, familyMembersCount = 1, contact = '', medicalNeeds = 'None' }) => {
        const shelter = state.shelters.find((s) => s.id === shelterId)
        if (!shelter) return { success: false, error: 'Shelter not found.' }
        if (!canManageShelter(shelterId)) return { success: false, error: 'You are not assigned to manage this shelter.' }
        const count = Math.max(1, Number(familyMembersCount) || 1)
        if (shelter.occupancy + count > shelter.capacity) {
          return { success: false, error: `Cannot check in ${count} people. Exceeds capacity (${shelter.capacity - shelter.occupancy} beds left).` }
        }
        const occupant = {
          id: `OCC-${Date.now().toString().slice(-4)}`,
          shelterId,
          shelterName: shelter.name,
          name: name.trim(),
          familyMembersCount: count,
          contact: contact.trim() || 'Not provided',
          medicalNeeds: medicalNeeds.trim() || 'None',
          checkInAt: new Date().toISOString(),
          status: 'Checked In',
        }
        update('occupants', (items) => [occupant, ...items])
        update('shelters', (items) => items.map((s) => (s.id === shelterId ? { ...s, occupancy: s.occupancy + count } : s)))
        log(`Checked in ${occupant.name} (${count} people) at ${shelter.name}`, 'users')
        if (shelter.capacity - (shelter.occupancy + count) <= shelter.capacity * 0.15) {
          notify('Shelter nearing capacity', `${shelter.name} has only ${shelter.capacity - (shelter.occupancy + count)} beds left.`, 'High', 'Shelter')
        }
        return { success: true, occupant }
      },
      checkOutOccupant: (occupantId) => {
        const occ = state.occupants.find((o) => o.id === occupantId)
        if (!occ || occ.status !== 'Checked In') return false
        if (!canManageShelter(occ.shelterId)) return false
        const shelter = state.shelters.find((s) => s.id === occ.shelterId)
        const count = occ.familyMembersCount || 1
        update('occupants', (items) => items.map((o) => (o.id === occupantId ? { ...o, status: 'Checked Out', checkOutAt: new Date().toISOString() } : o)))
        if (shelter) {
          update('shelters', (items) => items.map((s) => (s.id === occ.shelterId ? { ...s, occupancy: Math.max(0, s.occupancy - count) } : s)))
        }
        log(`Checked out ${occ.name} (${count} people) from ${occ.shelterName}`, 'users')
        return true
      },

      // Shelter Issues & Condition Reports
      reportShelterIssue: ({ shelterId, shelterName, issueType, description, severity = 'High' }) => {
        const shelter = state.shelters.find((item) => item.id === shelterId)
        if (!shelter || !canManageShelter(shelterId)) return false
        const item = {
          id: createRecordId('ISS'),
          shelterId,
          shelterName: shelter.name,
          issueType,
          description: description.trim(),
          severity,
          status: 'Reported',
          reportedBy: state.user?.name || 'Shelter Manager',
          reportedAt: new Date().toISOString(),
        }
        update('shelterIssues', (items) => [item, ...items])
        log(`Shelter issue reported for ${shelterName}: ${issueType}`, 'alert')
        notify(`Shelter issue reported — ${shelterName}`, `${issueType}: ${description}`, severity, 'Shelter')
        return item.id
      },
      resolveShelterIssue: (id) => {
        const issue = state.shelterIssues.find((i) => i.id === id)
        if (!issue || !canManageShelter(issue.shelterId)) return false
        update('shelterIssues', (items) => items.map((i) => (i.id === id ? { ...i, status: 'Resolved' } : i)))
        log(`Shelter issue ${id} marked resolved`, 'check')
        notify(`Shelter issue resolved`, `${issue.shelterName}: ${issue.issueType} has been resolved.`, 'Low', 'Shelter')
        return true
      },

      // Resources & Supply Request Workflow (Requested -> Approved -> Dispatched -> Received)
      addResource: (resource) => {
        if (state.user?.role !== 'Authority Administrator') return false
        const item = { ...resource, id: createRecordId('RES'), updatedAt: new Date().toISOString() }
        update('resources', (items) => [item, ...items])
        update('transactions', (items) => [
          { id: `TX-${Date.now().toString().slice(-5)}`, item: item.item, change: item.quantity, shelter: item.shelter, note: 'Stock received', at: new Date().toISOString() },
          ...items,
        ])
        log(`Added ${item.quantity} ${item.item} to ${item.shelter}`, 'box')
        return item.id
      },
      updateResource: (id, changes) => {
        if (state.user?.role !== 'Authority Administrator') return false
        const resource = state.resources.find((item) => item.id === id)
        if (!resource || !Number.isInteger(changes.quantity) || changes.quantity < 0) return false
        const change = changes.quantity - resource.quantity
        update('resources', (items) => items.map((item) => (item.id === id ? { ...item, ...changes, updatedAt: new Date().toISOString() } : item)))
        if (change) {
          update('transactions', (items) => [
            { id: `TX-${Date.now().toString().slice(-5)}`, item: resource.item, change, shelter: changes.shelter || resource.shelter, note: 'Inventory adjustment', at: new Date().toISOString() },
            ...items,
          ])
        }
        return true
      },
      dispatchResource: (id, quantity, shelter) => {
        if (state.user?.role !== 'Authority Administrator') return false
        const resource = state.resources.find((item) => item.id === id)
        if (!resource || quantity < 1 || quantity > resource.quantity) return false
        const now = new Date().toISOString()
        update('resources', (items) => [
          { id: `RES-${String(Date.now()).slice(-4)}`, item: resource.item, quantity, shelter, updatedAt: now },
          ...items.map((item) => (item.id === id ? { ...item, quantity: item.quantity - quantity, updatedAt: now } : item)),
        ])
        update('transactions', (items) => [
          { id: `TX-${Date.now().toString().slice(-5)}`, item: resource.item, change: -quantity, shelter: resource.shelter, note: `Relief dispatch to ${shelter}`, at: now },
          { id: `TX-${(Date.now() + 1).toString().slice(-5)}`, item: resource.item, change: quantity, shelter, note: 'Allocation received', at: now },
          ...items,
        ])
        log(`${quantity} ${resource.item.toLowerCase()} dispatched to ${shelter}`, 'truck')
        const remaining = resource.quantity - quantity
        if (remaining <= 50 && resource.quantity > 50) {
          notify('Low resource stock', `${remaining} ${resource.item.toLowerCase()} remain at ${resource.shelter}.`, remaining <= 30 ? 'High' : 'Medium', 'Resource')
        }
        return true
      },

      // Supply Request Lifecycle Handlers
      createResourceRequest: ({ item, quantity, shelter, priority = 'Medium', notes = '' }) => {
        const parsedQty = Number(quantity)
        if (!Number.isInteger(parsedQty) || parsedQty <= 0) return false
        const targetShelter = state.shelters.find((entry) => entry.name === shelter)
        if (!targetShelter || !canManageShelter(targetShelter.id)) return false
        const request = {
          id: createRecordId('REQ'),
          item,
          quantity: parsedQty,
          shelter,
          priority,
          notes,
          status: 'Pending',
          requestedBy: state.user?.name || 'Shelter Manager',
          at: new Date().toISOString(),
        }
        update('resourceRequests', (items) => [request, ...items])
        log(`Supply request ${request.id} for ${request.quantity} ${request.item} submitted by ${request.shelter}`, 'box')
        notify(`New shelter supply request`, `${request.shelter} requested ${request.quantity} ${request.item} (Priority: ${request.priority})`, request.priority === 'High' ? 'High' : 'Low', 'Resource')
        return request.id
      },
      approveResourceRequest: (id, status = 'Approved') => {
        if (state.user?.role !== 'Authority Administrator') return false
        const request = state.resourceRequests.find((item) => item.id === id)
        if (!request || request.status !== 'Pending') return false
        update('resourceRequests', (items) => items.map((item) => (item.id === id ? { ...item, status } : item)))
        log(`Supply request ${id} ${status.toLowerCase()} by authority`, 'check')
        notify(`Supply request ${status.toLowerCase()}`, `Request ${id} for ${request.item} (${request.shelter}) was ${status.toLowerCase()}.`, status === 'Declined' ? 'Medium' : 'Low', 'Resource')
        return true
      },
      dispatchResourceRequest: (id) => {
        if (state.user?.role !== 'Authority Administrator') return false
        const request = state.resourceRequests.find((item) => item.id === id)
        if (!request || ['Received', 'Dispatched', 'Declined'].includes(request.status)) return false
        const now = new Date().toISOString()
        update('resourceRequests', (items) => items.map((item) => (item.id === id ? { ...item, status: 'Dispatched', dispatchedAt: now } : item)))
        log(`Supplies for request ${id} dispatched to ${request.shelter}`, 'truck')
        notify(`Supplies dispatched to ${request.shelter}`, `${request.quantity} ${request.item} are on the way. Confirm receipt upon arrival.`, 'Medium', 'Resource')
        return true
      },
      // CRITICAL: Stock increases ONLY here upon confirmed physical arrival, preventing duplicate updates.
      recordSupplyReceipt: (id) => {
        const request = state.resourceRequests.find((item) => item.id === id)
        if (!request) return { success: false, error: 'Request not found.' }
        const requestShelter = state.shelters.find((shelter) => shelter.name === request.shelter)
        if (!requestShelter || !canManageShelter(requestShelter.id)) {
          return { success: false, error: 'You are not assigned to manage this shelter.' }
        }
        if (request.status === 'Received') {
          return { success: false, error: 'This shipment has already been confirmed and received into inventory.' }
        }
        if (!['Dispatched', 'Approved', 'Pending', 'Fulfilled'].includes(request.status)) {
          return { success: false, error: `Cannot receive supplies with status: ${request.status}.` }
        }

        const now = new Date().toISOString()
        const targetShelter = request.shelter
        const targetItem = request.item
        const addedQty = request.quantity

        // 1. Update shelter inventory
        update('resources', (currentResources) => {
          const existing = currentResources.find((r) => r.shelter === targetShelter && r.item === targetItem)
          if (existing) {
            return currentResources.map((r) => (r.id === existing.id ? { ...r, quantity: r.quantity + addedQty, updatedAt: now } : r))
          } else {
            return [
              {
                id: `RES-${Date.now().toString().slice(-4)}`,
                item: targetItem,
                quantity: addedQty,
                shelter: targetShelter,
                updatedAt: now,
              },
              ...currentResources,
            ]
          }
        })

        // 2. Mark request as Received
        update('resourceRequests', (requests) => requests.map((r) => (r.id === id ? { ...r, status: 'Received', receivedAt: now } : r)))

        // 3. Record stock transaction
        update('transactions', (txs) => [
          {
            id: `TX-${Date.now().toString().slice(-5)}`,
            item: targetItem,
            change: addedQty,
            shelter: targetShelter,
            note: `Confirmed receipt of request ${request.id}`,
            at: now,
          },
          ...txs,
        ])

        // 4. Audit & notification
        log(`Shelter ${targetShelter} confirmed receipt of ${addedQty} ${targetItem} (Request ${request.id})`, 'box')
        notify(`Supply delivery confirmed`, `${addedQty} ${targetItem} received and added to inventory at ${targetShelter}.`, 'Low', 'Resource')

        return { success: true }
      },

      // Volunteers & Field Operations
      addVolunteer: (volunteer) => {
        if (state.user?.role !== 'Authority Administrator') return false
        const item = { ...volunteer, id: createRecordId('VOL'), tasks: [] }
        update('volunteers', (items) => [item, ...items])
        log(`Registered volunteer ${item.name} (${item.area})`, 'users')
        return item.id
      },
      addTask: (volunteerId, task) => {
        if (state.user?.role !== 'Authority Administrator') return false
        const volunteer = state.volunteers.find((item) => item.id === volunteerId)
        if (!volunteer) return false
        const newTask = {
          ...task,
          id: createRecordId('TSK'),
          status: 'Assigned',
          priority: task.priority || 'Medium',
          instructions: task.instructions || 'Proceed to the designated response location and report status upon arrival.',
        }
        update('volunteers', (items) =>
          items.map((item) => (item.id === volunteerId ? { ...item, tasks: [newTask, ...item.tasks], availability: 'On Duty' } : item))
        )
        log(`Task "${task.title}" assigned to ${volunteer.name}`, 'clipboard')
        notify('Volunteer task assigned', `${volunteer.name} was assigned: ${task.title}.`, 'Low', 'Volunteer')
        return true
      },
      updateTask: (volunteerId, taskId, status) => {
        if (!canManageVolunteer(volunteerId)) return false
        const volunteer = state.volunteers.find((item) => item.id === volunteerId)
        update('volunteers', (items) =>
          items.map((item) => (item.id === volunteerId ? { ...item, tasks: item.tasks.map((task) => (task.id === taskId ? { ...task, status } : task)) } : item))
        )
        const task = volunteer?.tasks.find((item) => item.id === taskId)
        if (volunteer && task && task.status !== status) {
          log(`Volunteer task "${task.title}" updated to ${status} by ${volunteer.name}`, 'check')
          notify('Volunteer task updated', `${volunteer.name}: ${task.title} is now ${status.toLowerCase()}.`, 'Low', 'Volunteer')
        }
        return Boolean(task)
      },
      acceptAvailableTask: (volunteerId, taskId) => {
        if (!canManageVolunteer(volunteerId)) return false
        const taskObj = state.availableTasks.find((t) => t.id === taskId)
        const volunteer = state.volunteers.find((v) => v.id === volunteerId)
        if (!taskObj || !volunteer) return false
        // Move task to volunteer tasks
        const assignedTask = {
          ...taskObj,
          status: 'Assigned',
          assignedAt: new Date().toISOString(),
        }
        update('availableTasks', (tasks) => tasks.filter((t) => t.id !== taskId))
        update('volunteers', (vols) =>
          vols.map((v) => (v.id === volunteerId ? { ...v, tasks: [assignedTask, ...v.tasks], availability: 'On Duty' } : v))
        )
        log(`Volunteer ${volunteer.name} accepted task: "${taskObj.title}"`, 'clipboard')
        notify(`Task accepted by volunteer`, `${volunteer.name} accepted task ${taskObj.title}.`, 'Low', 'Volunteer')
        return true
      },
      declineAvailableTask: (volunteerId, taskId) => {
        if (!canManageVolunteer(volunteerId)) return false
        const taskObj = state.availableTasks.find((t) => t.id === taskId)
        const volunteer = state.volunteers.find((v) => v.id === volunteerId)
        if (volunteer && taskObj) {
          log(`Volunteer ${volunteer.name} declined task: "${taskObj.title}"`, 'clipboard')
        }
        return true
      },
      reportBlockedTask: (volunteerId, taskId, reason, requestBackup = false) => {
        if (!canManageVolunteer(volunteerId)) return false
        const volunteer = state.volunteers.find((v) => v.id === volunteerId)
        if (!volunteer) return false
        if (!volunteer.tasks.some((task) => task.id === taskId)) return false
        update('volunteers', (vols) =>
          vols.map((v) =>
            v.id === volunteerId
              ? {
                  ...v,
                  tasks: v.tasks.map((t) => (t.id === taskId ? { ...t, status: 'Blocked', blockerReason: reason } : t)),
                }
              : v
          )
        )
        const task = volunteer.tasks.find((t) => t.id === taskId)
        log(`Task "${task?.title || taskId}" marked BLOCKED by ${volunteer.name}. Reason: ${reason}`, 'alert')
        notify(
          requestBackup ? 'URGENT: Volunteer backup requested' : 'Volunteer task blocked',
          `${volunteer.name} reported blocker on "${task?.title || taskId}": ${reason}`,
          requestBackup ? 'Critical' : 'High',
          'Volunteer'
        )
        return true
      },
      updateVolunteerSelfProfile: (volunteerId, details) => {
        if (state.user?.role !== 'Volunteer' || !canManageVolunteer(volunteerId)) return false
        const safeDetails = Object.fromEntries(
          ['skills', 'area', 'availability', 'contact'].filter((key) => details[key] !== undefined).map((key) => [key, details[key]])
        )
        update('volunteers', (items) => items.map((v) => (v.id === volunteerId ? { ...v, ...safeDetails } : v)))
        log(`Volunteer ${details.name || volunteerId} updated profile & availability`, 'users')
        return true
      },
      addFieldReport: (report) => {
        const volunteer = state.volunteers.find((item) => item.id === report.volunteerId)
        if (state.user?.role !== 'Volunteer' || !volunteer || volunteer.userId !== state.user.id) return false
        const item = {
          ...report,
          id: createRecordId('FLD'),
          volunteerId: volunteer.id,
          volunteerName: volunteer.name,
          submittedAt: new Date().toISOString(),
        }
        update('fieldReports', (items) => [item, ...items])
        log(`Field observation ${item.id} submitted by ${item.volunteerName} from ${item.location}`, 'map')
        notify(`Field observation report`, `${item.volunteerName} (${item.location}): ${item.observation}`, item.severity || 'Medium', 'Incident')
        return item.id
      },
      recordDelivery: (delivery) => {
        const volunteer = state.volunteers.find((item) => item.id === delivery.volunteerId)
        if (state.user?.role !== 'Volunteer' || !volunteer || volunteer.userId !== state.user.id) return false
        const item = {
          ...delivery,
          id: createRecordId('DEL'),
          volunteerId: volunteer.id,
          volunteerName: volunteer.name,
          deliveredAt: new Date().toISOString(),
        }
        update('deliveryLogs', (items) => [item, ...items])
        log(`Relief delivery recorded: ${item.quantity} ${item.item} delivered by ${item.volunteerName} to ${item.recipient}`, 'truck')
        notify('Relief delivery completed', `${item.volunteerName} completed delivery of ${item.quantity} ${item.item} to ${item.recipient}.`, 'Low', 'Volunteer')
        return item.id
      },

      // Official Broadcast Alerts with Geo-Targeting
      createBroadcastAlert: ({ title, message, severity = 'High', targetArea = 'All Regions', type = 'Incident' }) => {
        const item = {
          id: `ALT-${Date.now().toString().slice(-5)}`,
          title,
          message,
          severity,
          type,
          targetArea,
          at: new Date().toISOString(),
          readBy: [],
          read: false,
        }
        update('alerts', (items) => [item, ...items])
        log(`Official broadcast published: "${title}" [Target Area: ${targetArea}]`, 'alert')
        return item.id
      },

      // Notifications (User-specific read tracking)
      markRead: (id) =>
        state.user?.id && update('alerts', (items) =>
          items.map((item) => {
            if (item.id !== id) return item
            const currentReadBy = Array.isArray(item.readBy) ? item.readBy : []
            const updatedReadBy = !currentReadBy.includes(state.user.id) ? [...currentReadBy, state.user.id] : currentReadBy
            return { ...item, read: true, readBy: updatedReadBy }
          })
        ),
      markAllRead: () =>
        state.user?.id && update('alerts', (items) =>
          items.map((item) => {
            const currentReadBy = Array.isArray(item.readBy) ? item.readBy : []
            const updatedReadBy = !currentReadBy.includes(state.user.id) ? [...currentReadBy, state.user.id] : currentReadBy
            return { ...item, read: true, readBy: updatedReadBy }
          })
        ),
      isAlertRead: (alert, user = state.user) => isAlertReadByUser(alert, user),
    }
  }, [state, storageError])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}
