import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, AlertCircle, AlertOctagon, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, Boxes, Check, CheckCheck, ClipboardCheck,
  CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ClipboardList, Clock3, Cloud, Download, Droplets, ExternalLink,
  Eye, EyeOff, FileText, Filter, Flame, HeartPulse, Home, LifeBuoy, Lock, LogOut, Map, MapPin, Menu, MessageSquareWarning,
  MoreHorizontal, Package, Phone, Plus, Radio, RefreshCw, Search, Send, Settings as SettingsIcon, Shield, ShieldAlert, Siren,
  Truck, UserCheck, UserPlus, Users, Waves, X,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import L from 'leaflet'
import { roles } from './data.js'
import { getIncidentImageValidationError, MAX_INCIDENT_IMAGE_STORAGE_BYTES } from './imageUtils.js'
import { useApp } from './state.jsx'
import { findAssignedShelter, findVolunteerProfile, getGlobalSearchPath, isAlertReadByUser, isOwnedByUser, isShelterManagerAssignmentValid } from './stateUtils.js'
import 'leaflet/dist/leaflet.css'

const navItems = [
  { label: 'Dashboard', path: '/', icon: Home, roles },
  { label: 'Applications', path: '/applications', icon: ClipboardCheck, roles: ['Authority Administrator'] },
  { label: 'Incident Management', path: '/incidents', icon: Siren, roles: ['Authority Administrator'] },
  { label: 'Report Emergency', path: '/report', icon: MessageSquareWarning, roles },
  { label: 'Live Incident Map', path: '/map', icon: Map, roles },
  { label: 'Shelter Management', path: '/shelters', icon: Home, roles: ['Authority Administrator', 'Shelter Manager', 'Citizen'] },
  { label: 'Resource Management', path: '/resources', icon: Boxes, roles: ['Authority Administrator', 'Shelter Manager'] },
  { label: 'Volunteer Coordination', path: '/volunteers', icon: Users, roles: ['Authority Administrator'] },
  { label: 'Alerts & Notifications', path: '/alerts', icon: Bell, roles },
  { label: 'Analytics', path: '/analytics', icon: Activity, roles: ['Authority Administrator'] },
  { label: 'Settings', path: '/settings', icon: SettingsIcon, roles },
]

const severityColors = { Critical: '#dc2626', High: '#f97316', Medium: '#eab308', Low: '#16a34a' }
const statusOptions = ['Reported', 'Under Verification', 'Verified', 'Response Dispatched', 'Resolved', 'Rejected']
const typeOptions = ['Flood', 'Earthquake', 'Fire', 'Cyclone', 'Landslide', 'Other']

const roleDashboardLabels = {
  Citizen: 'Community Dashboard',
  'Authority Administrator': 'Authority Dashboard',
  Volunteer: 'Volunteer Field Desk',
  'Shelter Manager': 'Shelter Operations',
}


const chartTooltip = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.08)',
  fontSize: 12,
  fontWeight: 600,
  color: '#0f172a',
  padding: '8px 12px',
}

function timeAgo(date) {
  if (!date) return 'Just now'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? '' : 's'} ago`
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-IN').format(value || 0)
}

function cx(...values) {
  return values.filter(Boolean).join(' ')
}

function hasCoordinates(item) {
  return Number.isFinite(item?.lat) && Number.isFinite(item?.lng)
}

function compressIncidentImage(file) {
  const validationError = getIncidentImageValidationError(file)
  if (validationError) return Promise.reject(new Error(validationError))

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('This browser could not prepare the image.'))
        return
      }

      try {
        for (const size of [1600, 1280, 1024, 800]) {
          const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight))
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          context.drawImage(image, 0, 0, canvas.width, canvas.height)

          for (const quality of [0.82, 0.72, 0.62, 0.52]) {
            const compressed = canvas.toDataURL('image/jpeg', quality)
            const estimatedBytes = Math.ceil((compressed.length - compressed.indexOf(',') - 1) * 0.75)
            if (estimatedBytes <= MAX_INCIDENT_IMAGE_STORAGE_BYTES) {
              resolve(compressed)
              return
            }
          }
        }
        reject(new Error('The image could not be compressed enough for local storage. Choose a smaller image.'))
      } catch {
        reject(new Error('This browser could not compress the selected image.'))
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('The selected image could not be read.'))
    }
    image.src = objectUrl
  })
}

// CSV Export Utility
function exportToCSV(filename, rows, columns) {
  if (!rows || !rows.length) return
  const headers = columns.map((col) => `"${col.label.replace(/"/g, '""')}"`).join(',')
  const lines = rows.map((row) =>
    columns
      .map((col) => {
        const val = col.value ? col.value(row) : row[col.key]
        const str = val === null || val === undefined ? '' : String(val).replace(/"/g, '""')
        return `"${str}"`
      })
      .join(',')
  )
  const blob = new Blob([headers + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `${filename}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function Badge({ children, tone }) {
  const value = tone || children
  const key = String(value).toLowerCase().replaceAll(' ', '-')
  return <span className={`badge badge-${key}`}>{children}</span>
}

function PageTitle({ eyebrow, title, description, action }) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="page-title-action">{action}</div>}
    </div>
  )
}

function Panel({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function EmptyState({ title = 'Nothing to show yet', message = 'Try changing your filters or add a new record.' }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <ClipboardList size={21} />
      </div>
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  )
}

function ApplicationsSection({ compact = false }) {
  const {
    applications,
    applicationsError,
    applicationsLoading,
    loadApplications,
    reviewApplication,
  } = useApp()
  const [status, setStatus] = useState('PENDING')
  const [rejectingId, setRejectingId] = useState('')
  const [reasons, setReasons] = useState({})
  const [actionError, setActionError] = useState('')
  const [workingId, setWorkingId] = useState('')

  useEffect(() => {
    loadApplications(status)
  }, [status])

  const review = async (application, decision) => {
    setWorkingId(application.id)
    setActionError('')
    try {
      await reviewApplication(application.id, decision, reasons[application.id])
      setRejectingId('')
    } catch (error) {
      setActionError(error.message)
    } finally {
      setWorkingId('')
    }
  }

  return (
    <Panel
      title="Role Applications"
      subtitle="Review volunteer and shelter manager access requests"
      className="applications-panel"
    >
      <div className="application-tabs" role="tablist" aria-label="Application status">
        {[
          ['PENDING', 'Pending'],
          ['APPROVED', 'Approved'],
          ['REJECTED', 'Rejected'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={status === value}
            className={status === value ? 'active' : ''}
            onClick={() => setStatus(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {(applicationsError || actionError) && (
        <div className="error-banner" role="alert">{actionError || applicationsError}</div>
      )}
      {applicationsLoading ? (
        <div className="application-empty">Loading applications…</div>
      ) : applications.length === 0 ? (
        <div className="application-empty">
          No {status.toLowerCase()} role applications.
        </div>
      ) : (
        <div className="application-list">
          {applications.map((application) => (
            <article className="application-card" key={application.id}>
              <div className="application-card-heading">
                <div>
                  <strong>{application.name}</strong>
                  <span>{application.email}</span>
                </div>
                <Badge tone={application.status}>{application.status}</Badge>
              </div>
              <div className="application-meta">
                <span>{application.requestedRole}</span>
                {application.phone && <span>{application.phone}</span>}
                {application.applicationSubmittedAt && (
                  <span>Submitted {new Date(application.applicationSubmittedAt).toLocaleString()}</span>
                )}
              </div>
              {application.address && <p className="application-address">{application.address}</p>}
              {application.applicationReviewedBy && (
                <small className="muted">Reviewed by {application.applicationReviewedBy.name}</small>
              )}
              {application.applicationRejectionReason && (
                <p className="application-reason"><strong>Reason:</strong> {application.applicationRejectionReason}</p>
              )}
              {status === 'PENDING' && (
                <div className="application-actions">
                  {rejectingId === application.id ? (
                    <>
                      <textarea
                        aria-label={`Rejection reason for ${application.name}`}
                        value={reasons[application.id] || ''}
                        onChange={(event) => setReasons({ ...reasons, [application.id]: event.target.value })}
                        placeholder="Explain why this application is rejected"
                        maxLength={2000}
                        rows={2}
                      />
                      <button
                        className="button button-danger"
                        disabled={workingId === application.id || !reasons[application.id]?.trim()}
                        onClick={() => review(application, 'reject')}
                      >
                        {workingId === application.id ? 'Saving…' : 'Confirm rejection'}
                      </button>
                      <button className="button button-secondary" onClick={() => setRejectingId('')}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button
                        className="button button-primary"
                        disabled={workingId === application.id}
                        onClick={() => review(application, 'approve')}
                      >
                        <Check size={15} /> Approve
                      </button>
                      <button
                        className="button button-secondary"
                        disabled={workingId === application.id}
                        onClick={() => setRejectingId(application.id)}
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {compact && <Link className="text-link application-view-all" to="/applications">Open applications workspace <ArrowRight size={14} /></Link>}
    </Panel>
  )
}

function ApplicationsPage() {
  return (
    <>
      <PageTitle
        eyebrow="ACCOUNT ACCESS"
        title="Role Applications"
        description="Review and record decisions for volunteer and shelter manager account requests."
      />
      <ApplicationsSection />
    </>
  )
}

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-heading">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}

function Field({ label, children, hint, error }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && !error && <small>{hint}</small>}
      {error && <small className="field-error" role="alert">{error}</small>}
    </label>
  )
}

function Toast({ message, onClose }) {
  if (!message) return null
  return (
    <div className="toast" role="status">
      <span className="toast-check">
        <Check size={16} />
      </span>
      <span>{message}</span>
      <button className="icon-button" onClick={onClose} aria-label="Dismiss message">
        <X size={15} />
      </button>
    </div>
  )
}

function StatCard({ label, value, note, icon: Icon, color, change }) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon ${color}`}>
          <Icon size={18} />
        </span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">
        {change && (
          <span className={change.startsWith('+') ? 'change-up' : 'change-down'}>
            {change.startsWith('+') ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {change}
          </span>
        )}
        {note}
      </div>
    </article>
  )
}

function IncidentRows({ incidents, onSelect, compact = false }) {
  if (!incidents.length) return <EmptyState title="No matching incidents" message="No incidents match these filters." />
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Incident</th>
            <th>Disaster type</th>
            <th>Location</th>
            <th>Severity</th>
            <th>Reported</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => (
            <tr key={incident.id}>
              <td>
                <button className="table-link" onClick={() => onSelect(incident)}>
                  {incident.id}
                </button>
                <small className="cell-sub">{formatNumber(incident.affected)} people affected</small>
              </td>
              <td>
                <span className="type-cell">
                  {incident.type === 'Flood' ? <Waves size={15} /> : incident.type === 'Fire' ? <Flame size={15} /> : <AlertTriangle size={15} />}
                  {incident.type}
                </span>
              </td>
              <td className="location-cell">{incident.location}</td>
              <td>
                <Badge>{incident.severity}</Badge>
              </td>
              <td className="time-cell">{timeAgo(incident.reportedAt)}</td>
              <td>
                <Badge>{incident.status}</Badge>
              </td>
              <td>
                <button className="icon-button row-action" aria-label={`View ${incident.id}`} onClick={() => onSelect(incident)}>
                  <MoreHorizontal size={18} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {compact && (
        <div className="table-footer">
          Showing {incidents.length} most recent incidents <Link to="/incidents">View all <ArrowRight size={13} /></Link>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// ROLE A: CITIZEN COMMUNITY DASHBOARD
// ============================================================================
function CommunityDashboard({ user, incidents, shelters, onToast }) {
  const {
    rescueRequests,
    citizenReliefRequests,
    addRescueRequest,
    addCitizenReliefRequest,
    emergencyHelplines,
  } = useApp()

  const [selectedIncident, setSelectedIncident] = useState(null)
  const [activeTab, setActiveTab] = useState('reports') // 'reports' | 'rescue' | 'relief'
  const [showRescueModal, setShowRescueModal] = useState(false)
  const [showReliefModal, setShowReliefModal] = useState(false)

  // Rescue request form state
  const [rescueForm, setRescueForm] = useState({
    location: '',
    peopleCount: 1,
    medicalEmergency: false,
    description: '',
    priority: 'Critical',
    contact: user.phone || '+91 98200 44321',
  })
  const [rescueError, setRescueError] = useState('')

  // Relief supplies form state
  const [reliefForm, setReliefForm] = useState({
    item: 'Food packets',
    quantity: 5,
    urgency: 'High',
    location: user.address || 'Assi Ghat Community Camp',
    notes: '',
    contact: user.phone || '+91 98200 44321',
  })
  const [reliefError, setReliefError] = useState('')

  // Filter personal data strictly for this citizen
  const myReports = incidents.filter((item) => isOwnedByUser(item, 'reporterId', user))
  const myRescueRequests = rescueRequests.filter((item) => isOwnedByUser(item, 'citizenId', user))
  const myReliefRequests = citizenReliefRequests.filter((item) => isOwnedByUser(item, 'citizenId', user))

  const openShelters = shelters.filter((item) => item.status === 'Operational')
  const availableBeds = openShelters.reduce((sum, item) => sum + Math.max(0, item.capacity - item.occupancy), 0)

  const handleRescueSubmit = (e) => {
    e.preventDefault()
    if (!rescueForm.location.trim() || !rescueForm.description.trim()) {
      setRescueError('Please provide your location and emergency description.')
      return
    }
    const id = addRescueRequest({
      ...rescueForm,
      citizenName: user.name,
      peopleCount: Number(rescueForm.peopleCount) || 1,
    })
    setShowRescueModal(false)
    setRescueForm({
      location: '',
      peopleCount: 1,
      medicalEmergency: false,
      description: '',
      priority: 'Critical',
      contact: user.phone || '',
    })
    setRescueError('')
    onToast(`Rescue request submitted (Reference: ${id})`)
  }

  const handleReliefSubmit = (e) => {
    e.preventDefault()
    const qty = Number(reliefForm.quantity)
    if (!reliefForm.location.trim() || !Number.isInteger(qty) || qty <= 0) {
      setReliefError('Please enter a delivery location and valid quantity greater than zero.')
      return
    }
    const id = addCitizenReliefRequest({
      ...reliefForm,
      citizenName: user.name,
      quantity: qty,
    })
    setShowReliefModal(false)
    setReliefForm({
      item: 'Food packets',
      quantity: 5,
      urgency: 'High',
      location: user.address || '',
      notes: '',
      contact: user.phone || '',
    })
    setReliefError('')
    onToast(`Relief supply request submitted (Reference: ${id})`)
  }

  return (
    <>
      <PageTitle
        eyebrow="COMMUNITY RESPONSE & SAFETY"
        title={`Welcome, ${user.name.split(' ')[0]}.`}
        description="Submit emergency reports, request rescue assistance, coordinate relief supplies, and view nearby safe shelters."
        action={
          <div className="action-row">
            <button className="button button-danger" onClick={() => setShowRescueModal(true)}>
              <LifeBuoy size={16} /> Request Urgent Rescue
            </button>
            <Link className="button button-primary" to="/report">
              <Plus size={16} /> Report Emergency
            </Link>
          </div>
        }
      />

      <div className="stats-grid compact-stats community-stats">
        <StatCard label="My incident reports" value={myReports.length} note="submitted with your profile" icon={MessageSquareWarning} color="orange" />
        <StatCard label="My rescue requests" value={myRescueRequests.length} note="active and past rescue requests" icon={LifeBuoy} color="red" />
        <StatCard label="My relief requests" value={myReliefRequests.length} note="food, water, medicine, blankets" icon={Boxes} color="blue" />
        <StatCard label="Available shelter beds" value={formatNumber(availableBeds)} note="across operational relief centres" icon={Home} color="green" />
      </div>

      <div className="citizen-notice">
        <ShieldAlert size={17} />
        <div>
          <strong>Emergency Safety Notice</strong>
          <span>This prototype coordinates simulated emergency services. In a life-threatening emergency, call 112 (Unified Emergency) or 1078 (NDRF) immediately.</span>
        </div>
      </div>

      <div className="dashboard-lower role-dashboard-lower">
        <div className="dashboard-main-flow">
          <div className="tab-pill-bar">
            <button className={cx('tab-pill', activeTab === 'reports' && 'active')} onClick={() => setActiveTab('reports')}>
              <MessageSquareWarning size={15} /> My Reports ({myReports.length})
            </button>
            <button className={cx('tab-pill', activeTab === 'rescue' && 'active')} onClick={() => setActiveTab('rescue')}>
              <LifeBuoy size={15} /> My Rescue Requests ({myRescueRequests.length})
            </button>
            <button className={cx('tab-pill', activeTab === 'relief' && 'active')} onClick={() => setActiveTab('relief')}>
              <Boxes size={15} /> Relief Supplies ({myReliefRequests.length})
            </button>
          </div>

          {activeTab === 'reports' && (
            <Panel
              title="My Emergency Reports"
              subtitle="Incident reports submitted by you. Click any report to view review status or cancel."
              action={
                <Link className="button button-small button-secondary" to="/report">
                  <Plus size={14} /> New report
                </Link>
              }
            >
              {myReports.length ? (
                <IncidentRows incidents={myReports} onSelect={setSelectedIncident} />
              ) : (
                <EmptyState
                  title="No emergency reports submitted yet"
                  message="If you witness or experience an emergency, click 'Report Emergency' to inform coordinators."
                />
              )}
            </Panel>
          )}

          {activeTab === 'rescue' && (
            <Panel
              title="My Rescue Requests"
              subtitle="Urgent evacuation and search & rescue tracking."
              action={
                <button className="button button-small button-danger" onClick={() => setShowRescueModal(true)}>
                  <Plus size={14} /> Request Rescue
                </button>
              }
            >
              {myRescueRequests.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Request ID</th>
                        <th>Location</th>
                        <th>People</th>
                        <th>Medical Emergency</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th>Assigned Team</th>
                        <th>Reported</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myRescueRequests.map((req) => (
                        <tr key={req.id}>
                          <td className="table-id">{req.id}</td>
                          <td>{req.location}</td>
                          <td><strong>{req.peopleCount}</strong></td>
                          <td>{req.medicalEmergency ? <Badge tone="Critical">Yes (Urgent)</Badge> : <span className="muted">No</span>}</td>
                          <td><Badge>{req.priority}</Badge></td>
                          <td><Badge>{req.status}</Badge></td>
                          <td>{req.assignedTeam ? <span className="team-tag"><Truck size={13} /> {req.assignedTeam}</span> : <span className="muted">Awaiting Dispatch</span>}</td>
                          <td className="time-cell">{timeAgo(req.reportedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="No rescue requests active"
                  message="Need immediate evacuation? Use the 'Request Urgent Rescue' button above."
                />
              )}
            </Panel>
          )}

          {activeTab === 'relief' && (
            <Panel
              title="My Relief Supply Requests"
              subtitle="Track requested food, water, medicine, blankets, and essential relief kits."
              action={
                <button className="button button-small button-secondary" onClick={() => setShowReliefModal(true)}>
                  <Plus size={14} /> Request Supplies
                </button>
              }
            >
              {myReliefRequests.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Request ID</th>
                        <th>Supplies</th>
                        <th>Quantity</th>
                        <th>Urgency</th>
                        <th>Delivery Location</th>
                        <th>Status</th>
                        <th>Requested</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myReliefRequests.map((req) => (
                        <tr key={req.id}>
                          <td className="table-id">{req.id}</td>
                          <td><span className="type-cell"><Package size={14} /> {req.item}</span></td>
                          <td><strong>{req.quantity}</strong> units</td>
                          <td><Badge>{req.urgency}</Badge></td>
                          <td>{req.location}</td>
                          <td><Badge>{req.status}</Badge></td>
                          <td className="time-cell">{timeAgo(req.requestedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="No relief requests logged"
                  message="Submit requests for drinking water, food packets, emergency medicines, or blankets."
                />
              )}
            </Panel>
          )}
        </div>

        <div className="widget-stack">
          <Panel title="Emergency Contacts & Helplines" subtitle="24/7 direct toll-free emergency links">
            <div className="helpline-list">
              {emergencyHelplines.map((line) => (
                <div className="helpline-item" key={line.number}>
                  <div>
                    <strong>{line.name}</strong>
                    <small>{line.desc}</small>
                  </div>
                  <a className="helpline-call" href={`tel:${line.number}`} aria-label={`Call ${line.name}`}>
                    <Phone size={14} /> {line.number}
                  </a>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Nearby Safe Shelters"
            subtitle="Operational relief centres with available beds"
            action={<Link className="text-link" to="/shelters">View all centres <ArrowRight size={13} /></Link>}
          >
            {openShelters.slice(0, 3).map((shelter) => (
              <div className="community-shelter" key={shelter.id}>
                <span className="community-shelter-icon">
                  <Home size={15} />
                </span>
                <span>
                  <strong>{shelter.name}</strong>
                  <small>{shelter.location} · {shelter.capacity - shelter.occupancy} beds free</small>
                </span>
                <Badge tone="Resolved">Open</Badge>
              </div>
            ))}
          </Panel>

          <Link className="community-map-cta" to="/map">
            <Map size={17} />
            <span>
              <strong>View live situational map</strong>
              <small>Check flood lines, fires, and safe evacuation corridors</small>
            </span>
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>

      {/* Rescue Request Modal */}
      {showRescueModal && (
        <Modal title="Request Urgent Rescue & Evacuation" onClose={() => setShowRescueModal(false)}>
          <form className="form-stack modal-form" onSubmit={handleRescueSubmit}>
            <p className="modal-description-copy">
              Submit an urgent dispatch ticket for people stranded or requiring immediate emergency search & rescue.
            </p>
            <Field label="Exact Location or Nearby Landmark" error={rescueError && !rescueForm.location ? 'Location is required.' : null}>
              <input
                required
                value={rescueForm.location}
                onChange={(e) => setRescueForm({ ...rescueForm, location: e.target.value })}
                placeholder="e.g. Assi Ghat Lane 4, 2nd floor balcony"
              />
            </Field>
            <div className="form-grid">
              <Field label="Number of Stranded People">
                <input
                  type="number"
                  min="1"
                  required
                  value={rescueForm.peopleCount}
                  onChange={(e) => setRescueForm({ ...rescueForm, peopleCount: e.target.value })}
                />
              </Field>
              <Field label="Urgency / Priority">
                <select value={rescueForm.priority} onChange={(e) => setRescueForm({ ...rescueForm, priority: e.target.value })}>
                  <option value="Critical">Critical (Immediate Danger)</option>
                  <option value="High">High (Water Rising / Structural Risk)</option>
                  <option value="Medium">Medium (Precautionary Evacuation)</option>
                </select>
              </Field>
            </div>
            <Field label="Emergency Description & Hazards">
              <textarea
                required
                rows={3}
                value={rescueForm.description}
                onChange={(e) => setRescueForm({ ...rescueForm, description: e.target.value })}
                placeholder="Describe current water level, obstacles, elderly/infants needing medical assistance..."
              />
            </Field>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={rescueForm.medicalEmergency}
                onChange={(e) => setRescueForm({ ...rescueForm, medicalEmergency: e.target.checked })}
              />
              <span>Medical Emergency: Someone requires urgent medical attention (oxygen, trauma, critical medicine).</span>
            </label>
            <Field label="Contact Phone for Responders">
              <input
                value={rescueForm.contact}
                onChange={(e) => setRescueForm({ ...rescueForm, contact: e.target.value })}
                placeholder="+91 90000 00000"
              />
            </Field>
            {rescueError && <small className="field-error">{rescueError}</small>}
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setShowRescueModal(false)}>
                Cancel
              </button>
              <button type="submit" className="button button-danger">
                <LifeBuoy size={16} /> Dispatch Rescue Ticket
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Relief Supplies Modal */}
      {showReliefModal && (
        <Modal title="Request Relief Supplies" onClose={() => setShowReliefModal(false)}>
          <form className="form-stack modal-form" onSubmit={handleReliefSubmit}>
            <p className="modal-description-copy">
              Request food packets, clean drinking water, first-aid medicines, or blankets for affected families.
            </p>
            <div className="form-grid">
              <Field label="Required Relief Item">
                <select value={reliefForm.item} onChange={(e) => setReliefForm({ ...reliefForm, item: e.target.value })}>
                  <option>Food packets</option>
                  <option>Drinking water</option>
                  <option>Medicines</option>
                  <option>Blankets</option>
                  <option>First-aid kits</option>
                </select>
              </Field>
              <Field label="Quantity Required (Units)">
                <input
                  type="number"
                  min="1"
                  required
                  value={reliefForm.quantity}
                  onChange={(e) => setReliefForm({ ...reliefForm, quantity: e.target.value })}
                />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Urgency Level">
                <select value={reliefForm.urgency} onChange={(e) => setReliefForm({ ...reliefForm, urgency: e.target.value })}>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </Field>
              <Field label="Contact Phone">
                <input
                  value={reliefForm.contact}
                  onChange={(e) => setReliefForm({ ...reliefForm, contact: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Delivery Location or Community Cluster">
              <input
                required
                value={reliefForm.location}
                onChange={(e) => setReliefForm({ ...reliefForm, location: e.target.value })}
                placeholder="e.g. Assi Ghat Relief Tent 4"
              />
            </Field>
            <Field label="Notes or Special Dietary / Medical Needs">
              <textarea
                rows={2}
                value={reliefForm.notes}
                onChange={(e) => setReliefForm({ ...reliefForm, notes: e.target.value })}
                placeholder="e.g. Diabetics, baby food formula, ORS packets required"
              />
            </Field>
            {reliefError && <small className="field-error">{reliefError}</small>}
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setShowReliefModal(false)}>
                Cancel
              </button>
              <button type="submit" className="button button-primary">
                <Send size={15} /> Submit Supply Request
              </button>
            </div>
          </form>
        </Modal>
      )}

      {selectedIncident && (
        <IncidentDialog
          incident={selectedIncident}
          onClose={() => setSelectedIncident(null)}
          onToast={onToast}
        />
      )}
    </>
  )
}

// ============================================================================
// ROLE C: VOLUNTEER FIELD DESK
// ============================================================================
function VolunteerDashboard({ user, volunteers, incidents, onToast }) {
  const {
    updateTask,
    availableTasks,
    acceptAvailableTask,
    declineAvailableTask,
    reportBlockedTask,
    updateVolunteerSelfProfile,
    addFieldReport,
    recordDelivery,
    deliveryLogs,
  } = useApp()

  const profile = findVolunteerProfile(volunteers, user)
  const tasks = profile?.tasks || []
  const activeTasks = tasks.filter((task) => ['Assigned', 'In Progress', 'Blocked'].includes(task.status))
  const completedTasks = tasks.filter((task) => task.status === 'Completed')
  const myDeliveryLogs = deliveryLogs.filter((log) => log.volunteerId === profile?.id)

  // Modals
  const [blockedModal, setBlockedModal] = useState(null)
  const [blockerReason, setBlockerReason] = useState('')
  const [requestBackup, setRequestBackup] = useState(false)

  const [showProfileModal, setShowProfileModal] = useState(false)
  const [profileForm, setProfileForm] = useState({
    skills: profile?.skills?.join(', ') || '',
    area: profile?.area || 'Varanasi',
    availability: profile?.availability || 'Available',
    contact: profile?.contact || '+91 90000 12001',
  })

  const [showFieldModal, setShowFieldModal] = useState(false)
  const [fieldForm, setFieldForm] = useState({
    location: profile?.area || 'Assi Ghat Lowland',
    observation: '',
    severity: 'High',
    lat: '',
    lng: '',
  })

  const [showDeliveryModal, setShowDeliveryModal] = useState(false)
  const [deliveryForm, setDeliveryForm] = useState({
    recipient: 'Riverside Community Hall',
    item: 'Food packets',
    quantity: 30,
  })

  if (!profile) {
    return <EmptyState title="Volunteer profile unavailable" message="No volunteer profile is linked to your account. Contact an administrator to resolve the assignment." />
  }

  const linkedIncident = (id) => incidents.find((item) => item.id === id)

  const handleBlockSubmit = (e) => {
    e.preventDefault()
    if (!blockerReason.trim()) return
    reportBlockedTask(profile.id, blockedModal.id, blockerReason, requestBackup)
    onToast(`Task ${blockedModal.title} flagged as blocked`)
    setBlockedModal(null)
    setBlockerReason('')
    setRequestBackup(false)
  }

  const handleProfileSubmit = (e) => {
    e.preventDefault()
    updateVolunteerSelfProfile(profile.id, {
      ...profileForm,
      skills: profileForm.skills.split(',').map((s) => s.trim()).filter(Boolean),
    })
    setShowProfileModal(false)
    onToast('Volunteer profile and availability updated')
  }

  const handleFieldSubmit = (e) => {
    e.preventDefault()
    if (!fieldForm.observation.trim() || !fieldForm.location.trim()) return
    const reportId = addFieldReport({
      ...fieldForm,
      volunteerId: profile.id,
      lat: fieldForm.lat ? Number(fieldForm.lat) : undefined,
      lng: fieldForm.lng ? Number(fieldForm.lng) : undefined,
    })
    if (!reportId) {
      onToast('Your volunteer profile could not be verified. Contact an administrator.')
      return
    }
    setShowFieldModal(false)
    setFieldForm({ location: profile?.area || '', observation: '', severity: 'High', lat: '', lng: '' })
    onToast('Field observation report shared with command center')
  }

  const handleDeliverySubmit = (e) => {
    e.preventDefault()
    const qty = Number(deliveryForm.quantity)
    if (!deliveryForm.recipient.trim() || qty <= 0) return
    const deliveryId = recordDelivery({
      ...deliveryForm,
      volunteerId: profile.id,
      quantity: qty,
    })
    if (!deliveryId) {
      onToast('Your volunteer profile could not be verified. Contact an administrator.')
      return
    }
    setShowDeliveryModal(false)
    onToast(`Relief delivery recorded: ${qty} ${deliveryForm.item}`)
  }

  return (
    <>
      <PageTitle
        eyebrow="VOLUNTEER FIELD DESK"
        title={`Your Shift, ${profile?.name?.split(' ')[0] || user.name}.`}
        description="Review assigned tasks, accept new field assignments in your area, and report blocked operations."
        action={
          <div className="action-row">
            <button className="button button-secondary" onClick={() => setShowDeliveryModal(true)}>
              <Package size={15} /> Record Delivery
            </button>
            <button className="button button-secondary" onClick={() => setShowFieldModal(true)}>
              <MapPin size={15} /> Field Report
            </button>
            <button className="button button-primary" onClick={() => setShowProfileModal(true)}>
              <UserCheck size={15} /> Edit My Profile
            </button>
          </div>
        }
      />

      <div className="stats-grid compact-stats volunteer-stats">
        <StatCard label="Active tasks" value={activeTasks.length} note="currently assigned to you" icon={ClipboardList} color="blue" />
        <StatCard label="Available in area" value={availableTasks.length} note="open tasks awaiting volunteers" icon={Plus} color="orange" />
        <StatCard label="Completed this shift" value={completedTasks.length} note="tasks successfully closed" icon={CheckCheck} color="green" />
        <StatCard label="My readiness" value={profile?.availability || 'Available'} note={`Service area: ${profile?.area || 'General'}`} icon={HeartPulse} color="purple" />
      </div>

      <div className="dashboard-lower role-dashboard-lower">
        <div className="dashboard-main-flow">
          {/* Active Shift Tasks */}
          <Panel title="My Active Response Assignments" subtitle={`${activeTasks.length} in progress · Update status as you advance`}>
            {tasks.length ? (
              <div className="volunteer-task-list">
                {tasks.map((task) => {
                  const incident = linkedIncident(task.incidentId)
                  return (
                    <article className={cx('volunteer-task-card', task.status === 'Blocked' && 'task-blocked-card')} key={task.id}>
                      <div className="volunteer-task-head">
                        <span className="task-card-icon">
                          <ClipboardList size={16} />
                        </span>
                        <div className="task-badges">
                          {task.priority && <Badge>{task.priority}</Badge>}
                          <Badge>{task.status}</Badge>
                        </div>
                      </div>

                      <h3>{task.title}</h3>
                      {task.instructions && <p className="task-instructions"><FileText size={13} /> {task.instructions}</p>}
                      <p className="task-incident-ref">
                        {incident ? `${incident.id} · ${incident.type} · ${incident.location}` : 'General community assignment'}
                      </p>

                      {task.status === 'Blocked' && (
                        <div className="blocker-banner">
                          <AlertTriangle size={14} />
                          <span><strong>Blocked:</strong> {task.blockerReason || 'Unspecified obstacle'}</span>
                        </div>
                      )}

                      <div className="volunteer-task-bottom">
                        <span>{incident ? <Badge>{incident.severity}</Badge> : <span className="muted">No linked incident</span>}</span>
                        {incident && (
                          <Link className="text-link" to={`/map?incident=${incident.id}`}>
                            View incident on map <ArrowRight size={13} />
                          </Link>
                        )}
                      </div>

                      <div className="task-action-footer">
                        <label className="task-status-control">
                          <span>Status</span>
                          <select
                            value={task.status}
                            aria-label={`Update ${task.title} progress`}
                            onChange={(event) => {
                              updateTask(profile.id, task.id, event.target.value)
                              onToast(`Task updated to ${event.target.value}`)
                            }}
                          >
                            {['Assigned', 'In Progress', 'Completed'].map((status) => (
                              <option key={status}>{status}</option>
                            ))}
                          </select>
                        </label>
                        {task.status !== 'Completed' && (
                          <button
                            className="button button-small button-danger-outline"
                            onClick={() => {
                              setBlockedModal(task)
                              setBlockerReason('')
                              setRequestBackup(false)
                            }}
                          >
                            <AlertCircle size={13} /> Report Blocked
                          </button>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <EmptyState title="No active assignments" message="Select an eligible task from the pool below to begin." />
            )}
          </Panel>

          {/* Available Tasks Pool */}
          <Panel
            title="Available Response Tasks in Your Area"
            subtitle={`${availableTasks.length} open tasks. Review instructions and click Accept to add to your shift.`}
          >
            {availableTasks.length ? (
              <div className="available-tasks-grid">
                {availableTasks.map((task) => (
                  <article className="available-task-card" key={task.id}>
                    <div className="available-task-head">
                      <strong>{task.title}</strong>
                      <Badge>{task.priority}</Badge>
                    </div>
                    <p>{task.instructions}</p>
                    <div className="available-task-meta">
                      <span><MapPin size={13} /> {task.area}</span>
                      {task.incidentId && <span>Ref: {task.incidentId}</span>}
                    </div>
                    <div className="available-task-actions">
                      <button
                        className="button button-small button-secondary"
                        onClick={() => {
                          declineAvailableTask(profile.id, task.id)
                          onToast(`Declined task: ${task.title}`)
                        }}
                      >
                        Decline
                      </button>
                      <button
                        className="button button-small button-primary"
                        onClick={() => {
                          acceptAvailableTask(profile.id, task.id)
                          onToast(`Accepted task: ${task.title}`)
                        }}
                      >
                        <Check size={14} /> Accept Task
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="No unassigned tasks right now" message="All field tasks in your area are currently covered." />
            )}
          </Panel>
        </div>

        <div className="widget-stack">
          <Panel title="Volunteer Profile & Readiness" subtitle={profile?.name || user.name}>
            <div className="readiness-card">
              <span className="avatar">{profile?.name.split(' ').map((p) => p[0]).join('')}</span>
              <div>
                <strong>{profile?.availability || 'Available'}</strong>
                <small>{profile?.area || 'General Area'} · {profile?.contact}</small>
              </div>
              <Badge>{profile?.availability || 'Available'}</Badge>
            </div>
            <div className="volunteer-skill-list">
              <span>ACTIVE SKILLS</span>
              <div>
                {(profile?.skills || []).map((skill) => (
                  <i key={skill}>{skill}</i>
                ))}
              </div>
            </div>
            <button className="button button-secondary button-full" onClick={() => setShowProfileModal(true)}>
              Edit skills & availability
            </button>
          </Panel>

          <Panel title="Recent Delivery Logs" subtitle="Relief distributions recorded by volunteers">
            {myDeliveryLogs.length ? (
              <div className="delivery-log-list">
                {myDeliveryLogs.slice(0, 4).map((log) => (
                  <div className="delivery-log-item" key={log.id}>
                    <div>
                      <strong>{log.quantity} {log.item}</strong>
                      <small>Delivered to {log.recipient} by {log.volunteerName}</small>
                    </div>
                    <Badge tone="Resolved">{timeAgo(log.deliveredAt)}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No deliveries logged" />
            )}
          </Panel>

          <Panel title="Field Safety & Dispatch Contact">
            <div className="field-reminder">
              <Shield size={16} />
              <span>Prioritize personal safety; never enter flood waters without backup.</span>
            </div>
            <div className="field-reminder">
              <Radio size={16} />
              <span>VHF Dispatch Channel: <strong>156.800 MHz (Ch 16)</strong></span>
            </div>
            <div className="field-reminder">
              <Phone size={16} />
              <span>Control Room Hot-Line: <strong>1070</strong></span>
            </div>
          </Panel>
        </div>
      </div>

      {/* Report Blocked Modal */}
      {blockedModal && (
        <Modal title={`Report Blocked: ${blockedModal.title}`} onClose={() => setBlockedModal(null)}>
          <form className="form-stack modal-form" onSubmit={handleBlockSubmit}>
            <p className="modal-description-copy">
              Flag this assignment as blocked if physical obstacles, danger, or resource shortages prevent progress.
            </p>
            <Field label="Reason for Blockage">
              <textarea
                required
                rows={3}
                value={blockerReason}
                onChange={(e) => setBlockerReason(e.target.value)}
                placeholder="e.g. Access road submerged by 4 feet of fast water; boat assistance required."
              />
            </Field>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={requestBackup}
                onChange={(e) => setRequestBackup(e.target.checked)}
              />
              <span><strong>Request Emergency Backup:</strong> Send a priority alert to the Authority Incident Commander.</span>
            </label>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setBlockedModal(null)}>
                Cancel
              </button>
              <button type="submit" className="button button-danger">
                Submit Blocker Report
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit Profile Modal */}
      {showProfileModal && (
        <Modal title="Edit Volunteer Profile" onClose={() => setShowProfileModal(false)}>
          <form className="form-stack modal-form" onSubmit={handleProfileSubmit}>
            <Field label="Availability Status">
              <select
                value={profileForm.availability}
                onChange={(e) => setProfileForm({ ...profileForm, availability: e.target.value })}
              >
                <option>Available</option>
                <option>On Duty</option>
                <option>Off Duty</option>
              </select>
            </Field>
            <Field label="Service Area / City">
              <input
                required
                value={profileForm.area}
                onChange={(e) => setProfileForm({ ...profileForm, area: e.target.value })}
              />
            </Field>
            <Field label="Skills (comma-separated)">
              <input
                value={profileForm.skills}
                onChange={(e) => setProfileForm({ ...profileForm, skills: e.target.value })}
                placeholder="First Aid, Water Rescue, Driving, Logistics"
              />
            </Field>
            <Field label="Contact Phone">
              <input
                value={profileForm.contact}
                onChange={(e) => setProfileForm({ ...profileForm, contact: e.target.value })}
              />
            </Field>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setShowProfileModal(false)}>
                Cancel
              </button>
              <button type="submit" className="button button-primary">
                Save Profile
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Field Report Modal */}
      {showFieldModal && (
        <Modal title="Submit Field Observation" onClose={() => setShowFieldModal(false)}>
          <form className="form-stack modal-form" onSubmit={handleFieldSubmit}>
            <Field label="Observation Location">
              <input
                required
                value={fieldForm.location}
                onChange={(e) => setFieldForm({ ...fieldForm, location: e.target.value })}
                placeholder="e.g. Assi Riverbank Checkpoint"
              />
            </Field>
            <div className="form-grid">
              <Field label="Observed Severity">
                <select
                  value={fieldForm.severity}
                  onChange={(e) => setFieldForm({ ...fieldForm, severity: e.target.value })}
                >
                  <option>Critical</option>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </Field>
              <Field label="GPS Latitude (optional)">
                <input
                  type="number"
                  step="any"
                  value={fieldForm.lat}
                  onChange={(e) => setFieldForm({ ...fieldForm, lat: e.target.value })}
                  placeholder="25.291"
                />
              </Field>
            </div>
            <Field label="Field Observation Notes">
              <textarea
                required
                rows={3}
                value={fieldForm.observation}
                onChange={(e) => setFieldForm({ ...fieldForm, observation: e.target.value })}
                placeholder="Report road blockages, receding flood levels, supply needs, crowd conditions..."
              />
            </Field>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setShowFieldModal(false)}>
                Cancel
              </button>
              <button type="submit" className="button button-primary">
                Submit Observation
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Record Delivery Modal */}
      {showDeliveryModal && (
        <Modal title="Record Relief Delivery" onClose={() => setShowDeliveryModal(false)}>
          <form className="form-stack modal-form" onSubmit={handleDeliverySubmit}>
            <Field label="Delivery Recipient / Shelter / Camp">
              <input
                required
                value={deliveryForm.recipient}
                onChange={(e) => setDeliveryForm({ ...deliveryForm, recipient: e.target.value })}
                placeholder="e.g. Riverside Community Hall"
              />
            </Field>
            <div className="form-grid">
              <Field label="Supplies Delivered">
                <select
                  value={deliveryForm.item}
                  onChange={(e) => setDeliveryForm({ ...deliveryForm, item: e.target.value })}
                >
                  <option>Food packets</option>
                  <option>Drinking water</option>
                  <option>Medicines</option>
                  <option>Blankets</option>
                  <option>First-aid kits</option>
                </select>
              </Field>
              <Field label="Quantity Delivered">
                <input
                  type="number"
                  min="1"
                  required
                  value={deliveryForm.quantity}
                  onChange={(e) => setDeliveryForm({ ...deliveryForm, quantity: e.target.value })}
                />
              </Field>
            </div>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setShowDeliveryModal(false)}>
                Cancel
              </button>
              <button type="submit" className="button button-primary">
                Log Delivery
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

// ============================================================================
// ROLE D: SHELTER MANAGER DASHBOARD
// ============================================================================
function ShelterDashboard({ user, shelters, resources, resourceRequests, onToast }) {
  const {
    updateShelter,
    createResourceRequest,
    recordSupplyReceipt,
    occupants,
    checkInOccupant,
    checkOutOccupant,
    shelterIssues,
    reportShelterIssue,
    resolveShelterIssue,
  } = useApp()

  // Enforce role-appropriate isolation: Manager manages their assigned shelter
  const shelter = findAssignedShelter(shelters, user)
  const [showSupplyModal, setShowSupplyModal] = useState(false)
  const [supplyForm, setSupplyForm] = useState({ item: 'Drinking water', quantity: 50, priority: 'High', notes: '' })
  const [supplyError, setSupplyError] = useState('')
  const [showCheckInModal, setShowCheckInModal] = useState(false)
  const [checkInForm, setCheckInForm] = useState({ name: '', familyMembersCount: 1, contact: '', medicalNeeds: '' })
  const [checkInError, setCheckInError] = useState('')
  const [showIssueModal, setShowIssueModal] = useState(false)
  const [issueForm, setIssueForm] = useState({ issueType: 'Power Outage', description: '', severity: 'High' })

  if (!shelter) {
    return <EmptyState title="No shelter is assigned" message="Contact an administrator to link a shelter to your profile." />
  }

  const available = Math.max(0, shelter.capacity - shelter.occupancy)
  const occupancyPercent = Math.round((shelter.occupancy / shelter.capacity) * 100)
  const inventory = resources.filter((item) => item.shelter === shelter.name)
  const lowStock = inventory.filter((item) => item.quantity <= 50)
  const requests = resourceRequests.filter((item) => item.shelter === shelter.name)
  const myOccupants = occupants.filter((item) => item.shelterId === shelter.id && item.status === 'Checked In')
  const myIssues = shelterIssues.filter((item) => item.shelterId === shelter.id)

  // Validated occupancy adjuster
  const updateOccupancy = (delta) => {
    const value = shelter.occupancy + delta
    if (value < 0) {
      onToast('Occupancy cannot be less than zero.')
      return
    }
    if (value > shelter.capacity) {
      onToast(`Occupancy cannot exceed shelter capacity (${shelter.capacity}).`)
      return
    }
    if (!updateShelter(shelter.id, { occupancy: value })) {
      onToast('This shelter is not assigned to your account.')
      return
    }
    onToast(`Occupancy updated for ${shelter.name}`)
  }

  const handleSupplySubmit = (e) => {
    e.preventDefault()
    const qty = Number(supplyForm.quantity)
    if (!Number.isInteger(qty) || qty <= 0) {
      setSupplyError('Quantity must be a positive whole number.')
      return
    }
    const requestId = createResourceRequest({
      ...supplyForm,
      quantity: qty,
      shelter: shelter.name,
    })
    if (!requestId) {
      setSupplyError('This shelter is not assigned to your account.')
      return
    }
    setShowSupplyModal(false)
    setSupplyForm({ item: 'Drinking water', quantity: 50, priority: 'High', notes: '' })
    setSupplyError('')
    onToast(`Resource request submitted for ${shelter.name}`)
  }

  const handleCheckInSubmit = (e) => {
    e.preventDefault()
    if (!checkInForm.name.trim()) {
      setCheckInError('Please enter the evacuee head of family name.')
      return
    }
    const count = Number(checkInForm.familyMembersCount) || 1
    const res = checkInOccupant({
      shelterId: shelter.id,
      name: checkInForm.name,
      familyMembersCount: count,
      contact: checkInForm.contact,
      medicalNeeds: checkInForm.medicalNeeds,
    })
    if (!res.success) {
      setCheckInError(res.error)
      return
    }
    setShowCheckInModal(false)
    setCheckInForm({ name: '', familyMembersCount: 1, contact: '', medicalNeeds: '' })
    setCheckInError('')
    onToast(`Checked in ${count} evacuee(s) to ${shelter.name}`)
  }

  const handleConfirmReceipt = (reqId) => {
    const res = recordSupplyReceipt(reqId)
    if (!res.success) {
      onToast(res.error || 'Failed to record receipt')
    } else {
      onToast(`Supplies successfully confirmed and added to ${shelter.name} inventory!`)
    }
  }

  const handleIssueSubmit = (e) => {
    e.preventDefault()
    if (!issueForm.description.trim()) return
    const issueId = reportShelterIssue({
      shelterId: shelter.id,
      shelterName: shelter.name,
      ...issueForm,
    })
    if (!issueId) {
      onToast('This shelter is not assigned to your account.')
      return
    }
    setShowIssueModal(false)
    setIssueForm({ issueType: 'Power Outage', description: '', severity: 'High' })
    onToast(`Facility issue logged for ${shelter.name}`)
  }

  const handleExportShelterReport = () => {
    const reportData = [
      {
        Shelter: shelter.name,
        Location: shelter.location,
        Address: shelter.address,
        Capacity: shelter.capacity,
        Occupancy: shelter.occupancy,
        AvailableBeds: available,
        Utilization: `${occupancyPercent}%`,
        Status: shelter.status,
        ActiveEvacuees: myOccupants.length,
        TotalSuppliesTracked: inventory.length,
        LowStockItems: lowStock.length,
      },
    ]
    const columns = Object.keys(reportData[0]).map((k) => ({ label: k, key: k }))
    exportToCSV(`shelter-report-${shelter.id}`, reportData, columns)
    onToast('Shelter operational summary exported to CSV')
  }

  return (
    <>
      <PageTitle
        eyebrow="SHELTER COMMAND & OPERATIONS"
        title={shelter.name}
        description={`${shelter.location} · Managed by ${shelter.manager || user.name}. Complete roster, inventory, and supply chain control.`}
        action={
          <div className="action-row">
            <button className="button button-secondary" onClick={handleExportShelterReport}>
              <Download size={15} /> Export Report
            </button>
            <button className="button button-secondary" onClick={() => setShowIssueModal(true)}>
              <AlertTriangle size={15} /> Report Issue
            </button>
            <button className="button button-secondary" onClick={() => setShowCheckInModal(true)}>
              <UserPlus size={15} /> Check In Evacuee
            </button>
            <button className="button button-primary" onClick={() => setShowSupplyModal(true)}>
              <Plus size={15} /> Request Supplies
            </button>
          </div>
        }
      />

      <div className="stats-grid compact-stats shelter-manager-stats">
        <StatCard label="Current occupancy" value={formatNumber(shelter.occupancy)} note={`of ${formatNumber(shelter.capacity)} total capacity`} icon={Users} color="blue" />
        <StatCard label="Beds available" value={formatNumber(available)} note="real-time bed count" icon={Home} color={available <= shelter.capacity * 0.15 ? 'red' : 'green'} />
        <StatCard label="Checked-in families" value={myOccupants.length} note="active evacuees on roster" icon={UserCheck} color="purple" />
        <StatCard label="Supply alerts" value={lowStock.length} note="items needing replenishment" icon={Boxes} color="amber" />
      </div>

      <div className="shelter-ops-grid">
        {/* Capacity & Arrivals Panel */}
        <Panel title="Capacity & Utilization" subtitle={`${shelter.id} · Status: ${shelter.status}`} action={<Badge>{shelter.status}</Badge>}>
          <div className="shelter-occupancy-number">
            <strong>{occupancyPercent}%</strong>
            <span>of maximum capacity</span>
          </div>
          <div className="progress-track occupancy-large">
            <i className={occupancyPercent >= 85 ? 'progress-warn' : ''} style={{ width: `${Math.min(100, occupancyPercent)}%` }} />
          </div>
          <div className="shelter-occupancy-meta">
            <span>{formatNumber(shelter.occupancy)} people accommodated</span>
            <strong>{formatNumber(available)} beds free</strong>
          </div>
          <div className="occupancy-actions shelter-dashboard-controls">
            <button className="button button-secondary" disabled={shelter.occupancy <= 0} onClick={() => updateOccupancy(-1)}>
              −1 Departure
            </button>
            <span>Record Arrival / Departure</span>
            <button className="button button-secondary" disabled={shelter.occupancy >= shelter.capacity} onClick={() => updateOccupancy(1)}>
              +1 Arrival
            </button>
          </div>
          <div className="facility-list shelter-dashboard-facilities">
            {shelter.facilities.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </Panel>

        {/* Local Inventory Panel */}
        <Panel
          title="Supply Check & Stock"
          subtitle="Inventory currently stored at this shelter"
          action={
            <button className="button button-small button-secondary" onClick={() => setShowSupplyModal(true)}>
              <Plus size={13} /> Order supplies
            </button>
          }
        >
          {inventory.length ? (
            inventory.map((item) => (
              <div className="supply-check-row" key={item.id}>
                <span className="stock-icon">
                  <Package size={15} />
                </span>
                <span>
                  <strong>{item.item}</strong>
                  <small>{item.id} · updated {timeAgo(item.updatedAt)}</small>
                </span>
                <Badge tone={item.quantity <= 30 ? 'Critical' : item.quantity <= 50 ? 'Medium' : 'Resolved'}>
                  {item.quantity} units
                </Badge>
              </div>
            ))
          ) : (
            <EmptyState title="No inventory logged" message="Submit a supply request to order resources." />
          )}
          {lowStock.length > 0 && (
            <div className="shelter-stock-notice">
              <AlertTriangle size={14} /> {lowStock.length} resource item{lowStock.length === 1 ? ' needs' : 's need'} replenishment.
            </div>
          )}
        </Panel>
      </div>

      {/* Evacuee Check-In Roster */}
      <Panel
        title="Evacuee Check-In Roster"
        subtitle={`${myOccupants.length} checked-in individuals & family heads currently accommodated`}
        action={
          <button className="button button-small button-secondary" onClick={() => setShowCheckInModal(true)}>
            <Plus size={14} /> Check In Evacuee
          </button>
        }
      >
        {myOccupants.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Head of Family</th>
                  <th>Family Size</th>
                  <th>Contact</th>
                  <th>Medical / Dietary Needs</th>
                  <th>Check-In Time</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {myOccupants.map((occ) => (
                  <tr key={occ.id}>
                    <td className="table-id">{occ.id}</td>
                    <td><strong>{occ.name}</strong></td>
                    <td>{occ.familyMembersCount} persons</td>
                    <td>{occ.contact}</td>
                    <td>{occ.medicalNeeds !== 'None' ? <Badge tone="Medium">{occ.medicalNeeds}</Badge> : 'None'}</td>
                    <td className="time-cell">{timeAgo(occ.checkInAt)}</td>
                    <td>
                      <button
                        className="button button-small button-secondary"
                        onClick={() => {
                          checkOutOccupant(occ.id)
                          onToast(`Checked out ${occ.name} and freed ${occ.familyMembersCount} bed(s)`)
                        }}
                      >
                        Check Out
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No active evacuees checked in" message="Use the Check In button when new evacuees arrive." />
        )}
      </Panel>

      {/* Supply Requests & Physical Receipt Confirmation Workflow */}
      <Panel
        title="Supply Requests & Delivery Receipt"
        subtitle="Requested → Approved → Dispatched → Received. Physical receipt confirms stock into inventory."
        action={
          <button className="button button-small button-primary" onClick={() => setShowSupplyModal(true)}>
            <Plus size={14} /> Request supplies
          </button>
        }
      >
        {requests.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Request ID</th>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Receipt Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td className="table-id">{request.id}</td>
                    <td><strong>{request.item}</strong></td>
                    <td>{formatNumber(request.quantity)} units</td>
                    <td><Badge>{request.priority}</Badge></td>
                    <td><Badge>{request.status}</Badge></td>
                    <td className="time-cell">{timeAgo(request.at)}</td>
                    <td>
                      {request.status === 'Received' ? (
                        <span className="receipt-confirmed-badge">
                          <CheckCircle2 size={14} /> Stock Added
                        </span>
                      ) : ['Dispatched', 'Approved'].includes(request.status) ? (
                        <button
                          className="button button-small button-primary confirm-receipt-btn"
                          onClick={() => handleConfirmReceipt(request.id)}
                        >
                          <Check size={14} /> Confirm Delivery Receipt
                        </button>
                      ) : request.status === 'Pending' ? (
                        <span className="muted">Awaiting Admin Review</span>
                      ) : (
                        <Badge tone="Critical">Declined</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No supply requests logged" message="Create a request to order food, water, or medicines." />
        )}
      </Panel>

      {/* Facility Condition Reports */}
      {myIssues.length > 0 && (
        <Panel title="Facility & Maintenance Issues" subtitle="Reported shelter maintenance conditions">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Issue ID</th>
                  <th>Issue Type</th>
                  <th>Description</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Reported</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {myIssues.map((issue) => (
                  <tr key={issue.id}>
                    <td className="table-id">{issue.id}</td>
                    <td><strong>{issue.issueType}</strong></td>
                    <td>{issue.description}</td>
                    <td><Badge>{issue.severity}</Badge></td>
                    <td><Badge>{issue.status}</Badge></td>
                    <td className="time-cell">{timeAgo(issue.reportedAt)}</td>
                    <td>
                      {issue.status !== 'Resolved' ? (
                        <button
                          className="button button-small button-secondary"
                          onClick={() => {
                            resolveShelterIssue(issue.id)
                            onToast(`Issue ${issue.id} marked resolved`)
                          }}
                        >
                          Mark Resolved
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Request Supplies Modal */}
      {showSupplyModal && (
        <Modal title={`Request Supplies for ${shelter.name}`} onClose={() => setShowSupplyModal(false)}>
          <form className="form-stack modal-form" onSubmit={handleSupplySubmit}>
            <Field label="Relief Item">
              <select
                value={supplyForm.item}
                onChange={(e) => setSupplyForm({ ...supplyForm, item: e.target.value })}
              >
                <option>Food packets</option>
                <option>Drinking water</option>
                <option>Medicines</option>
                <option>Blankets</option>
                <option>First-aid kits</option>
                <option>Rescue equipment</option>
              </select>
            </Field>
            <div className="form-grid">
              <Field label="Quantity Required">
                <input
                  type="number"
                  min="1"
                  required
                  value={supplyForm.quantity}
                  onChange={(e) => setSupplyForm({ ...supplyForm, quantity: e.target.value })}
                />
              </Field>
              <Field label="Priority Level">
                <select
                  value={supplyForm.priority}
                  onChange={(e) => setSupplyForm({ ...supplyForm, priority: e.target.value })}
                >
                  <option>Critical</option>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </Field>
            </div>
            <Field label="Notes & Storage Requirements">
              <textarea
                rows={2}
                value={supplyForm.notes}
                onChange={(e) => setSupplyForm({ ...supplyForm, notes: e.target.value })}
                placeholder="e.g. Immediate delivery needed for new flood evacuees arriving tonight."
              />
            </Field>
            {supplyError && <small className="field-error">{supplyError}</small>}
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setShowSupplyModal(false)}>
                Cancel
              </button>
              <button type="submit" className="button button-primary">
                Submit Request
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Check In Modal */}
      {showCheckInModal && (
        <Modal title={`Check In Evacuees · ${shelter.name}`} onClose={() => setShowCheckInModal(false)}>
          <form className="form-stack modal-form" onSubmit={handleCheckInSubmit}>
            <p className="modal-description-copy">
              Available capacity: <strong>{available} beds</strong>. Check-ins exceeding capacity will be rejected.
            </p>
            <Field label="Head of Family / Individual Name">
              <input
                required
                value={checkInForm.name}
                onChange={(e) => setCheckInForm({ ...checkInForm, name: e.target.value })}
                placeholder="e.g. Ramesh Kumar"
              />
            </Field>
            <div className="form-grid">
              <Field label="Total Family Members Count">
                <input
                  type="number"
                  min="1"
                  max={available}
                  required
                  value={checkInForm.familyMembersCount}
                  onChange={(e) => setCheckInForm({ ...checkInForm, familyMembersCount: e.target.value })}
                />
              </Field>
              <Field label="Contact Phone">
                <input
                  value={checkInForm.contact}
                  onChange={(e) => setCheckInForm({ ...checkInForm, contact: e.target.value })}
                  placeholder="+91 90000 00000"
                />
              </Field>
            </div>
            <Field label="Medical / Special Needs (if any)">
              <input
                value={checkInForm.medicalNeeds}
                onChange={(e) => setCheckInForm({ ...checkInForm, medicalNeeds: e.target.value })}
                placeholder="e.g. Wheelchair accessible, insulin refrigeration, elderly"
              />
            </Field>
            {checkInError && <small className="field-error">{checkInError}</small>}
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setShowCheckInModal(false)}>
                Cancel
              </button>
              <button type="submit" className="button button-primary">
                Confirm Check In
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Facility Issue Modal */}
      {showIssueModal && (
        <Modal title={`Report Facility Issue · ${shelter.name}`} onClose={() => setShowIssueModal(false)}>
          <form className="form-stack modal-form" onSubmit={handleIssueSubmit}>
            <div className="form-grid">
              <Field label="Issue Type">
                <select
                  value={issueForm.issueType}
                  onChange={(e) => setIssueForm({ ...issueForm, issueType: e.target.value })}
                >
                  <option>Power Outage</option>
                  <option>Water Shortage</option>
                  <option>Structural Damage</option>
                  <option>Medical Supply Shortage</option>
                  <option>Sanitation</option>
                  <option>Other</option>
                </select>
              </Field>
              <Field label="Urgency / Severity">
                <select
                  value={issueForm.severity}
                  onChange={(e) => setIssueForm({ ...issueForm, severity: e.target.value })}
                >
                  <option>Critical</option>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </Field>
            </div>
            <Field label="Issue Description & Required Action">
              <textarea
                required
                rows={3}
                value={issueForm.description}
                onChange={(e) => setIssueForm({ ...issueForm, description: e.target.value })}
                placeholder="e.g. Main water pump burned out; need emergency water tanker within 4 hours."
              />
            </Field>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setShowIssueModal(false)}>
                Cancel
              </button>
              <button type="submit" className="button button-danger">
                Submit Facility Issue
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

// ============================================================================
// INCIDENT DETAILS DIALOG (VERIFICATION, REJECTION REASON & CANCELLATION)
// ============================================================================
function IncidentDialog({ incident, onClose, onToast }) {
  const { updateIncident, rejectIncidentWithReason, cancelIncident, user } = useApp()
  const [team, setTeam] = useState(incident.team || '')
  const [severity, setSeverity] = useState(incident.severity)
  const [status, setStatus] = useState(incident.status)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateError, setUpdateError] = useState('')

  // Modals for reason inputs
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  if (!incident) return null
  const canManage = user?.role === 'Authority Administrator'
  const isMyReport = isOwnedByUser(incident, 'reporterId', user)
  const canCancel = isMyReport && ['Reported', 'Under Verification'].includes(incident.status)

  const handleAdminSave = async () => {
    setIsUpdating(true)
    setUpdateError('')
    try {
      const updated = await updateIncident(incident.id, { status, severity, team: team || undefined })
      if (!updated) throw new Error('The incident could not be updated.')
      onToast(status !== incident.status ? 'Incident status saved' : 'Incident details updated in this session')
      onClose()
    } catch (error) {
      setUpdateError(error.message || 'Unable to update the incident. Please try again.')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleVerify = async () => {
    setIsUpdating(true)
    setUpdateError('')
    try {
      const updated = await updateIncident(incident.id, { status: 'Verified' })
      if (!updated) throw new Error('The incident could not be updated.')
      onToast('Report verified')
      onClose()
    } catch (error) {
      setUpdateError(error.message || 'Unable to verify the incident. Please try again.')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleRejectConfirm = async (e) => {
    e.preventDefault()
    if (!rejectReason.trim()) return
    setIsUpdating(true)
    setUpdateError('')
    try {
      const updated = await rejectIncidentWithReason(incident.id, rejectReason)
      if (!updated) throw new Error('The incident could not be rejected.')
      setShowRejectModal(false)
      onToast(`Incident ${incident.id} rejected.`)
      onClose()
    } catch (error) {
      setUpdateError(error.message || 'Unable to reject the incident. Please try again.')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleCancelConfirm = (e) => {
    e.preventDefault()
    if (!cancelReason.trim()) return
    cancelIncident(incident.id, cancelReason)
    setShowCancelModal(false)
    onToast(`Incident ${incident.id} cancelled.`)
    onClose()
  }

  return (
    <>
      <Modal title={`Incident ${incident.id}`} onClose={onClose} wide>
        <div className="incident-detail-top">
          <div>
            <Badge>{incident.severity}</Badge>
            <Badge>{incident.status}</Badge>
          </div>
          <span className="muted">{timeAgo(incident.reportedAt)}</span>
        </div>

        <p className="detail-description">{incident.description}</p>

        {incident.rejectionReason && (
          <div className="rejection-reason-box">
            <AlertTriangle size={15} />
            <div>
              <strong>Rejection / Cancellation Note:</strong>
              <span>{incident.rejectionReason}</span>
            </div>
          </div>
        )}

        <div className="detail-grid">
          <div><span>Disaster type</span><strong>{incident.type}</strong></div>
          <div><span>Location</span><strong>{incident.location}</strong></div>
          <div><span>People affected</span><strong>{formatNumber(incident.affected)}</strong></div>
          <div><span>Reported by</span><strong>{incident.reporter}</strong></div>
          <div><span>Contact</span><strong>{incident.contact || 'Not provided'}</strong></div>
          <div><span>Coordinates</span><strong>{hasCoordinates(incident) ? `${incident.lat.toFixed(4)}, ${incident.lng.toFixed(4)}` : 'Not provided'}</strong></div>
          <div><span>Assigned response team</span><strong>{incident.team || 'Not assigned'}</strong></div>
        </div>

        {incident.image && <img className="incident-evidence" src={incident.image} alt={`Evidence attached to ${incident.id}`} />}

        {canManage && (
          <div className="form-grid modal-form">
            <Field label="Incident status">
              <select value={status} disabled={isUpdating} onChange={(e) => setStatus(e.target.value)}>
                {statusOptions.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Severity">
              <select value={severity} disabled={isUpdating} onChange={(e) => setSeverity(e.target.value)}>
                {['Low', 'Medium', 'High', 'Critical'].map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Assign response team">
              <select value={team} disabled={isUpdating} onChange={(e) => setTeam(e.target.value)}>
                <option value="">No team assigned</option>
                {['River Rescue Unit', 'Medical Response Team', 'Urban Search & Rescue', 'Rapid Relief Team'].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </Field>
          </div>
        )}
        {canManage && (
          <small className="muted">Only incident status is saved to the backend. Severity and response-team changes remain local.</small>
        )}
        {isUpdating && <div className="incident-data-banner" role="status">Saving incident status…</div>}
        {updateError && <div className="error-banner" role="alert">{updateError}</div>}

        {canManage && ['Reported', 'Under Verification'].includes(incident.status) && (
          <div className="review-actions">
            <button className="button button-secondary" disabled={isUpdating} onClick={handleVerify}>
              <Check size={15} /> Verify Report
            </button>
            <button className="button button-danger-outline" disabled={isUpdating} onClick={() => setShowRejectModal(true)}>
              <X size={15} /> Reject with Reason
            </button>
          </div>
        )}

        <div className="modal-actions">
          <Link className="button button-secondary" to={`/map?incident=${incident.id}`} onClick={onClose}>
            <Map size={15} /> View on map
          </Link>
          {canCancel && (
            <button className="button button-danger-outline" onClick={() => setShowCancelModal(true)}>
              <X size={15} /> Cancel My Report
            </button>
          )}
          {canManage && (
            <button className="button button-primary" disabled={isUpdating} onClick={handleAdminSave}>
              {isUpdating ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>
      </Modal>

      {/* Rejection Reason Modal */}
      {showRejectModal && (
        <Modal title={`Reject Incident ${incident.id}`} onClose={() => setShowRejectModal(false)}>
          <form className="form-stack modal-form" onSubmit={handleRejectConfirm}>
            <p className="modal-description-copy">
              Enter a reason for this session’s incident record. Only the rejected status is saved to the backend.
            </p>
            <Field label="Rejection Reason">
              <textarea
                required
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Duplicate report already being addressed by River Rescue Unit (Ref: INC-2408)."
              />
            </Field>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" disabled={isUpdating} onClick={() => setShowRejectModal(false)}>
                Cancel
              </button>
              <button type="submit" className="button button-danger" disabled={isUpdating}>
                {isUpdating ? 'Saving…' : 'Confirm Rejection'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Citizen Cancel Report Modal */}
      {showCancelModal && (
        <Modal title={`Cancel Report ${incident.id}`} onClose={() => setShowCancelModal(false)}>
          <form className="form-stack modal-form" onSubmit={handleCancelConfirm}>
            <p className="modal-description-copy">
              Are you sure you want to cancel this emergency report? Responders will be notified that assistance is no longer required.
            </p>
            <Field label="Cancellation Reason">
              <input
                required
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Situation resolved safely by local volunteers."
              />
            </Field>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setShowCancelModal(false)}>
                Go Back
              </button>
              <button type="submit" className="button button-danger">
                Confirm Cancellation
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

// ============================================================================
// LOGIN & REGISTRATION PAGE
// ============================================================================
function LoginPage() {
  const { login, registerUser, storageError } = useApp()
  const [mode, setMode] = useState('signin') // 'signin' | 'register'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [registrationOutcome, setRegistrationOutcome] = useState(null)
  const navigate = useNavigate()

  // Registration fields
  const [regForm, setRegForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    role: 'CITIZEN',
    password: '',
    confirmPassword: '',
  })

  const handleSignIn = async (e) => {
    e.preventDefault()
    if (!username.trim()) {
      setError('Please enter your email address.')
      return
    }
    if (!password.trim()) {
      setError('Please enter your password.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await login(username.trim(), password)
      navigate('/')
    } catch (requestError) {
      setError(requestError.message || 'Unable to sign in. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    if (!regForm.name.trim() || !regForm.email.trim() || !regForm.password.trim()) {
      setError('Please fill in all required fields.')
      return
    }
    if (regForm.password !== regForm.confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (regForm.password.length < 12 || new TextEncoder().encode(regForm.password).length > 72) {
      setError('Password must be at least 12 characters and no more than 72 UTF-8 bytes.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const outcome = await registerUser(regForm)
      if (outcome?.status === 'PENDING') {
        setRegistrationOutcome(outcome)
      } else {
        navigate('/')
      }
    } catch (requestError) {
      setError(requestError.message || 'Unable to create your account. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        {storageError && <div className="warning-banner" role="alert"><AlertTriangle size={17} /><div><strong>Local changes are not saved</strong><span>{storageError}</span></div></div>}
        <Link to="/login" className="brand login-brand">
          <span className="brand-mark">
            <Cloud size={21} />
          </span>
          <span>
            ResQ<span>Cloud</span>
          </span>
        </Link>
        <span className="eyebrow">COMMAND ACCESS & COORDINATION</span>
        <h1>
          Ready when it<br />matters most.
        </h1>
        <p>Unified emergency command for citizens, responders, and relief agencies.</p>

        <div className="login-mode-tabs">
          <button className={cx('mode-tab', mode === 'signin' && 'active')} onClick={() => { setMode('signin'); setError(''); setRegistrationOutcome(null); }}>
            Sign In
          </button>
          <button className={cx('mode-tab', mode === 'register' && 'active')} onClick={() => { setMode('register'); setError(''); setRegistrationOutcome(null); }}>
            Create Account
          </button>
        </div>

        {mode === 'signin' ? (
          <form onSubmit={handleSignIn}>
            <Field label="Email Address">
              <input
                type="email"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value)
                  setError('')
                }}
                required
                placeholder="name@example.com"
                autoComplete="email"
              />
            </Field>

            <Field label="Password">
              <div className="password-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError('')
                  }}
                  required
                  placeholder="Enter password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>

            {error && <small className="field-error" role="alert">{error}</small>}

            <button className="button button-primary button-full" type="submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in to Command Center'} {!submitting && <ArrowRight size={16} />}
            </button>
          </form>
        ) : registrationOutcome ? (
          <div className="application-outcome" role="status">
            <CheckCircle2 size={22} />
            <div>
              <strong>{registrationOutcome.requestedRole} application submitted</strong>
              <p>Your application is pending administrator approval. You cannot use this role until it has been approved.</p>
            </div>
            <button className="button button-secondary button-full" onClick={() => { setMode('signin'); setRegistrationOutcome(null); }}>
              Return to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleRegister}>
            <div className="auth-role-note">Citizens activate immediately. Volunteer and Shelter Manager accounts require administrator approval.</div>

            <Field label="Account type">
              <select
                value={regForm.role}
                onChange={(event) => setRegForm({ ...regForm, role: event.target.value })}
              >
                <option value="CITIZEN">Citizen</option>
                <option value="VOLUNTEER">Volunteer</option>
                <option value="SHELTER_MANAGER">Shelter Manager</option>
              </select>
            </Field>

            <div className="form-grid">
              <Field label="Username">
                <input
                  required
                  value={regForm.name}
                  onChange={(e) => setRegForm({ ...regForm, name: e.target.value })}
                  placeholder="Enter username"
                />
              </Field>
              <Field label="Email Address">
                <input
                  type="email"
                  required
                  value={regForm.email}
                  onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                  placeholder="name@example.com"
                />
              </Field>
            </div>

            <div className="form-grid">
              <Field label="Contact Phone">
                <input
                  value={regForm.phone}
                  onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })}
                  placeholder="+91 90000 00000"
                />
              </Field>
              <Field label="Location / District">
                <input
                  value={regForm.address}
                  onChange={(e) => setRegForm({ ...regForm, address: e.target.value })}
                  placeholder="e.g. Varanasi City"
                />
              </Field>
            </div>

            <div className="form-grid">
              <Field label="Password">
                <input
                  type="password"
                  required
                  value={regForm.password}
                  onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                  placeholder="At least 12 characters"
                />
              </Field>
              <Field label="Confirm Password">
                <input
                  type="password"
                  required
                  value={regForm.confirmPassword}
                  onChange={(e) => setRegForm({ ...regForm, confirmPassword: e.target.value })}
                  placeholder="Re-enter password"
                />
              </Field>
            </div>

            {error && <small className="field-error">{error}</small>}

            <button className="button button-primary button-full" type="submit" disabled={submitting}>
              {submitting
                ? 'Submitting…'
                : regForm.role === 'CITIZEN'
                  ? 'Create Citizen Account'
                  : `Submit ${regForm.role === 'VOLUNTEER' ? 'Volunteer' : 'Shelter Manager'} Application`}
              {!submitting && <ArrowRight size={16} />}
            </button>
          </form>
        )}

        <small className="login-foot">ResQCloud · Disaster Management and Emergency Response System</small>
      </section>

      <aside className="login-aside">
        <div className="login-aside-content">
          <span className="live-chip">
            <span /> LIVE RESPONSE NETWORK
          </span>
          <h2>
            Every second counts.<br />
            <em>Every connection matters.</em>
          </h2>
          <p>
            Coordinating four vital disaster roles: Citizens reporting needs, Authority Administrators deploying assets,
            Volunteers delivering relief, and Shelter Managers protecting communities.
          </p>
          <div className="login-aside-stats">
            <div>
              <strong>4 Portals</strong>
              <span>role-tailored command</span>
            </div>
            <div>
              <strong>1 Shared State</strong>
              <span>synchronized response</span>
            </div>
          </div>
        </div>
        <div className="login-aside-bottom">
          <span>BUILT FOR RESILIENCE</span>
          <span>COMMUNITY-FIRST DISASTER RESPONSE</span>
        </div>
      </aside>
    </main>
  )
}

// ============================================================================
// APP LAYOUT & NAVIGATION
// ============================================================================
function AppLayout({ children, onSearch }) {
  const { user, alerts, logout, emergencyHelplines, storageError, incidentSource, incidentError, refreshIncidents } = useApp()
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [search, setSearch] = useState('')
  const location = useLocation()
  const navigate = useNavigate()

  const unread = alerts.filter((item) => !isAlertReadByUser(item, user)).length
  const allowed = navItems.filter((item) => item.roles.includes(user.role))
  const title =
    location.pathname === '/'
      ? roleDashboardLabels[user.role]
      : navItems.find((item) => item.path === location.pathname)?.label || 'Response Command'

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        document.getElementById('global-search-input')?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app-shell">
      <aside className={cx('sidebar', menuOpen && 'sidebar-open')}>
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Cloud size={21} />
          </span>
          <span>
            ResQ<span>Cloud</span>
          </span>
        </Link>
        <div className="workspace-label">RESPONSE NETWORK</div>
        <div className="network-status">
          <span className="status-dot" />
          {incidentSource === 'database' ? 'Incident API Connected' : incidentSource === 'loading' ? 'Loading live incidents…' : incidentSource === 'unavailable' ? 'Incident API Unavailable' : 'Demo incident data'}
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          {allowed.map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => cx('nav-link', isActive && 'active')}
            >
              <Icon size={17} />
              <span>{label}</span>
              {path === '/alerts' && unread > 0 && <b className="nav-count">{unread}</b>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="sidebar-help" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={17} />
            <div>
              <strong>Emergency Desk</strong>
              <span>Contacts & Protocol</span>
            </div>
            <ChevronRight size={15} />
          </button>

          <div className="sidebar-user">
            <div className="avatar">
              {user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="sidebar-user-copy">
              <strong>{user.name}</strong>
              <span>{user.role}</span>
            </div>
            <button className="icon-button sidebar-logout" aria-label="Sign out" onClick={logout}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {menuOpen && <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}

      <div className="main-column">
        {storageError && <div className="warning-banner" role="alert"><AlertTriangle size={17} /><div><strong>Local changes are not saved</strong><span>{storageError}</span></div></div>}
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              <span>ResQCloud</span>
              <ChevronRight size={14} />
              <strong>{title}</strong>
            </div>
          </div>

          <div className="topbar-actions">
            <form
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault()
                onSearch(search)
                if (search.trim()) navigate(getGlobalSearchPath(user.role))
              }}
            >
              <Search size={16} />
              <input
                id="global-search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search incidents..."
                aria-label="Search incidents"
              />
              {search && (
                <button
                  aria-label="Clear search"
                  type="button"
                  onClick={() => {
                    setSearch('')
                    onSearch('')
                  }}
                >
                  <X size={13} />
                </button>
              )}
              <kbd>⌘ K</kbd>
            </form>

            <Link to="/alerts" className="notification-button" aria-label={`${unread} unread notifications`}>
              <Bell size={18} />
              {unread > 0 && <i>{unread}</i>}
            </Link>

            <div className="profile-wrap">
              <button className="profile-trigger" onClick={() => setProfileOpen((open) => !open)}>
                <span className="avatar avatar-small">
                  {user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <span className="profile-label">
                  <strong>{user.name}</strong>
                  <small>{user.role}</small>
                </span>
                <ChevronDown size={15} />
              </button>
              {profileOpen && (
                <div className="profile-menu">
                  <Link to="/settings" onClick={() => setProfileOpen(false)}>
                    <SettingsIcon size={15} /> Settings
                  </Link>
                  <button onClick={logout}>
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>

            <Link to="/report" className="button button-primary top-report">
              <Plus size={16} /> Report Emergency
            </Link>
          </div>
        </header>

        <main className="main-content">
          {incidentSource === 'database' && (
            <div className="incident-data-banner" role="status">
              Incident reports are loaded from the ResQCloud backend. New reports are saved there; status/dispatch changes and other workflows remain local-only.
            </div>
          )}
          {incidentSource === 'loading' && (
            <div className="incident-data-banner" role="status">Loading incident reports from the backend…</div>
          )}
          {incidentSource === 'unavailable' && (
            <div className="warning-banner incident-api-error" role="alert">
              <AlertTriangle size={17} />
              <div>
                <strong>Live incident data is unavailable</strong>
                <span>{incidentError} Demo incidents are not shown while signed in.</span>
              </div>
              <button className="button button-secondary" onClick={refreshIncidents}>Retry</button>
            </div>
          )}
          {children}
        </main>

        <footer className="app-footer">
          <span>
            ResQCloud <b>·</b> Cloud-Based Disaster Management and Emergency Response System
          </span>
          <span>Backend incidents · Other workflows use local demo data</span>
        </footer>
      </div>

      {/* Emergency Help Dialog */}
      {helpOpen && (
        <Modal title="Disaster Emergency Helpline & Protocols" onClose={() => setHelpOpen(false)}>
          <div className="help-modal-content">
            <p className="modal-description-copy">
              ResQCloud provides unified incident communication. For life-threatening emergencies, dial national helplines:
            </p>
            <div className="helpline-grid-modal">
              {emergencyHelplines.map((item) => (
                <div className="helpline-modal-card" key={item.number}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.desc}</small>
                  </div>
                  <a className="helpline-pill" href={`tel:${item.number}`}>
                    <Phone size={14} /> {item.number}
                  </a>
                </div>
              ))}
            </div>
            <div className="protocol-box">
              <h4>Standard Operating Procedures (SOP)</h4>
              <ul>
                <li><strong>Assess Safety:</strong> Never place yourself or response teams in unmitigated danger.</li>
                <li><strong>Log Everything:</strong> Every dispatch, supply receipt, and occupant check-in updates the live dashboard.</li>
                <li><strong>Radio Coordination:</strong> In cell outages, switch to standard emergency VHF channels.</li>
              </ul>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ============================================================================
// MAIN DASHBOARD (SWITCHES BY ROLE)
// ============================================================================
function Dashboard({ onToast, onSearch, globalSearch }) {
  const { user, incidents, shelters, resources, resourceRequests, volunteers, activity } = useApp()
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState(globalSearch || '')
  const [severity, setSeverity] = useState('All severity')
  const [status, setStatus] = useState('All status')

  const active = incidents.filter((item) => !['Resolved', 'Rejected'].includes(item.status))
  const critical = active.filter((item) => item.severity === 'Critical')
  const people = active.reduce((total, item) => total + Number(item.affected || 0), 0)
  const beds = shelters
    .filter((item) => item.status === 'Operational')
    .reduce((total, item) => total + Math.max(0, item.capacity - item.occupancy), 0)
  const volunteersOnDuty = volunteers.filter((item) => item.availability === 'On Duty').length
  const pendingRequests = resourceRequests.filter((item) => item.status === 'Pending').length

  const filtered = useMemo(
    () =>
      incidents
        .filter(
          (item) =>
            (!search || `${item.id} ${item.type} ${item.location}`.toLowerCase().includes(search.toLowerCase())) &&
            (severity === 'All severity' || item.severity === severity) &&
            (status === 'All status' || item.status === status)
        )
        .slice(0, 5),
    [incidents, search, severity, status]
  )

  const typeData = typeOptions.map((type) => ({
    name: type,
    incidents: incidents.filter((item) => item.type === type).length,
  }))

  const severityData = ['Critical', 'High', 'Medium', 'Low'].map((name) => ({
    name,
    value: incidents.filter((item) => item.severity === name).length,
  }))

  const trend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - 6 + index)
    return {
      day: date.toLocaleDateString('en', { weekday: 'short' }),
      reports: incidents.filter((item) => new Date(item.reportedAt).toDateString() === date.toDateString()).length,
    }
  })

  const lowStock = resources.filter((item) => item.quantity <= 50)

  // Dispatch to role dashboards
  if (user.role === 'Citizen') {
    return <CommunityDashboard user={user} incidents={incidents} shelters={shelters} onToast={onToast} />
  }
  if (user.role === 'Volunteer') {
    return (
      <>
        {user.accountStatus === 'Approved' && <div className="approval-success-banner" role="status">Your Volunteer application has been approved.</div>}
        <VolunteerDashboard user={user} volunteers={volunteers} incidents={incidents} onToast={onToast} />
      </>
    )
  }
  if (user.role === 'Shelter Manager') {
    return (
      <>
        {user.accountStatus === 'Approved' && <div className="approval-success-banner" role="status">Your Shelter Manager application has been approved.</div>}
        <ShelterDashboard
          user={user}
          shelters={shelters}
          resources={resources}
          resourceRequests={resourceRequests}
          onToast={onToast}
        />
      </>
    )
  }

  // ROLE B: AUTHORITY ADMINISTRATOR DASHBOARD
  return (
    <>
      <PageTitle
        eyebrow="INCIDENT COMMAND OVERVIEW"
        title="Unified Disaster Command Center"
        description="Live operational telemetry across incident alerts, relief centres, volunteer deployments, and resources."
        action={
          <span className="updated-stamp">
            <span className="status-dot" /> Live Telemetry <ChevronDown size={14} />
          </span>
        }
      />

      <ApplicationsSection compact />

      <div className="stats-grid">
        <StatCard label="Active incidents" value={active.length} note="currently in response queue" icon={Siren} color="blue" change="+2" />
        <StatCard label="Critical incidents" value={critical.length} note="immediate dispatch required" icon={AlertOctagon} color="red" />
        <StatCard label="People affected" value={formatNumber(people)} note="estimated across incidents" icon={Users} color="blue" />
        <StatCard label="Available shelter beds" value={formatNumber(beds)} note="across operational shelters" icon={Home} color="green" />
        <StatCard label="Responders on duty" value={volunteersOnDuty} note={`of ${volunteers.length} registered volunteers`} icon={HeartPulse} color="purple" />
        <StatCard label="Pending supply requests" value={pendingRequests} note="awaiting resource allocation" icon={Boxes} color="amber" />
      </div>

      <div className="chart-grid">
        <Panel title="Incidents by disaster type" subtitle="Distribution across all reported emergencies">
          <div className="chart-box chart-bar">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={typeData} margin={{ top: 12, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#edf0f5" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#8691a5', fontSize: 11 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8691a5', fontSize: 11 }} />
                <Tooltip contentStyle={chartTooltip} />
                <Bar dataKey="incidents" fill="#2563eb" radius={[5, 5, 0, 0]} maxBarSize={35} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Incident report trend" subtitle="Incoming reports over the last 7 days" action={<span className="legend-dot blue-dot">Reports</span>}>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 12, right: 12, left: -22, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#edf0f5" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#8691a5', fontSize: 11 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8691a5', fontSize: 11 }} />
                <Tooltip contentStyle={chartTooltip} />
                <Line
                  type="monotone"
                  dataKey="reports"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#2563eb', strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Severity distribution" subtitle="Categorization by reported severity level">
          <div className="severity-chart">
            <div className="donut-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={severityData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={77} paddingAngle={3} stroke="none">
                    {severityData.map((entry) => (
                      <Cell key={entry.name} fill={severityColors[entry.name]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chartTooltip} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-total">
                <strong>{incidents.length}</strong>
                <span>incidents</span>
              </div>
            </div>
            <div className="severity-legend">
              {severityData.map((item) => (
                <div key={item.name}>
                  <span>
                    <i style={{ background: severityColors[item.name] }} />
                    {item.name}
                  </span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div className="dashboard-lower">
        <Panel
          title="Recent Incidents in Queue"
          subtitle="Latest reports awaiting review or active response"
          action={
            <Link className="text-link" to="/incidents">
              All incidents <ArrowRight size={14} />
            </Link>
          }
        >
          <div className="table-filters">
            <label className="search-box">
              <Search size={15} />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  onSearch(e.target.value)
                }}
                placeholder="Search incidents"
              />
            </label>
            <select aria-label="Filter by severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option>All severity</option>
              {['Critical', 'High', 'Medium', 'Low'].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option>All status</option>
              {statusOptions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <IncidentRows incidents={filtered} onSelect={setSelected} compact />
        </Panel>

        <div className="widget-stack">
          <Panel
            title="Critical Incident Alerts"
            action={
              <Link className="text-link" to="/alerts">
                View all <ArrowRight size={13} />
              </Link>
            }
          >
            {critical.length ? (
              critical.slice(0, 2).map((item) => (
                <button className="critical-alert" key={item.id} onClick={() => setSelected(item)}>
                  <span className="critical-icon">
                    <AlertOctagon size={16} />
                  </span>
                  <span>
                    <strong>{item.type} · {item.location}</strong>
                    <small>{item.id} · {timeAgo(item.reportedAt)}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))
            ) : (
              <EmptyState title="No critical alerts" message="No urgent critical incident tickets right now." />
            )}
          </Panel>

          <Panel
            title="Shelter Capacity Monitor"
            action={
              <Link className="text-link" to="/shelters">
                Manage <ArrowRight size={13} />
              </Link>
            }
          >
            {shelters
              .filter((item) => item.status === 'Operational')
              .slice(0, 3)
              .map((item) => {
                const percentage = Math.round((item.occupancy / item.capacity) * 100)
                return (
                  <div className="capacity-row" key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.capacity - item.occupancy} beds free</span>
                    </div>
                    <div className="progress-track">
                      <i className={percentage > 85 ? 'progress-warn' : ''} style={{ width: `${percentage}%` }} />
                    </div>
                    <small>{percentage}%</small>
                  </div>
                )
              })}
          </Panel>

          <Panel
            title="Supply Depletion Alerts"
            action={
              <Link className="text-link" to="/resources">
                Inventory <ArrowRight size={13} />
              </Link>
            }
          >
            {lowStock.length ? (
              lowStock.slice(0, 2).map((item) => (
                <div className="stock-row" key={item.id}>
                  <span className="stock-icon">
                    <Package size={15} />
                  </span>
                  <span>
                    <strong>{item.item}</strong>
                    <small>{item.shelter}</small>
                  </span>
                  <Badge tone={item.quantity <= 30 ? 'High' : 'Medium'}>{item.quantity} left</Badge>
                </div>
              ))
            ) : (
              <EmptyState title="Inventory levels healthy" />
            )}
          </Panel>

          <Panel title="Command Audit Feed" action={<span className="muted mini-text">LIVE</span>}>
            {activity.slice(0, 3).map((item) => (
              <div className="activity-row" key={item.id}>
                <span className="activity-icon">
                  <Activity size={14} />
                </span>
                <div>
                  <p>{item.text}</p>
                  <small>{timeAgo(item.at)} · {item.role || 'System'}</small>
                </div>
              </div>
            ))}
          </Panel>
        </div>
      </div>

      {selected && <IncidentDialog incident={selected} onClose={() => setSelected(null)} onToast={onToast} />}
    </>
  )
}

// ============================================================================
// INCIDENTS PAGE (WITH RESCUE REQUESTS QUEUE & CSV EXPORT)
// ============================================================================
function IncidentsPage({ onToast, globalSearch }) {
  const { incidents, rescueRequests, updateIncident, updateRescueRequest, user } = useApp()
  const [activeTab, setActiveTab] = useState('incidents') // 'incidents' | 'rescue'
  const [search, setSearch] = useState(globalSearch || '')
  const [severity, setSeverity] = useState('All severity')
  const [status, setStatus] = useState('All status')
  const [sortBy, setSortBy] = useState('reportedAt') // 'reportedAt' | 'severity' | 'affected'
  const [sortOrder, setSortOrder] = useState('desc')

  const [selected, setSelected] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [confirmUpdating, setConfirmUpdating] = useState(false)
  const [confirmError, setConfirmError] = useState('')

  // Rescue dispatch modal
  const [rescueDispatchModal, setRescueDispatchModal] = useState(null)
  const [dispatchTeam, setDispatchTeam] = useState('River Rescue Unit')
  const [dispatchStatus, setDispatchStatus] = useState('In Progress')

  useEffect(() => {
    setSearch(globalSearch || '')
  }, [globalSearch])

  // Filtering incidents
  const filteredIncidents = useMemo(() => {
    let result = incidents.filter(
      (item) =>
        (!search || `${item.id} ${item.type} ${item.location} ${item.reporter}`.toLowerCase().includes(search.toLowerCase())) &&
        (severity === 'All severity' || item.severity === severity) &&
        (status === 'All status' || item.status === status)
    )

    result.sort((a, b) => {
      let comparison = 0
      if (sortBy === 'reportedAt') {
        comparison = new Date(b.reportedAt) - new Date(a.reportedAt)
      } else if (sortBy === 'affected') {
        comparison = (b.affected || 0) - (a.affected || 0)
      } else if (sortBy === 'severity') {
        const order = { Critical: 4, High: 3, Medium: 2, Low: 1 }
        comparison = (order[b.severity] || 0) - (order[a.severity] || 0)
      }
      return sortOrder === 'asc' ? -comparison : comparison
    })
    return result
  }, [incidents, search, severity, status, sortBy, sortOrder])

  // Filtering rescue requests
  const filteredRescue = useMemo(() => {
    return rescueRequests.filter(
      (r) => !search || `${r.id} ${r.citizenName} ${r.location}`.toLowerCase().includes(search.toLowerCase())
    )
  }, [rescueRequests, search])

  const confirmStatus = async () => {
    setConfirmUpdating(true)
    setConfirmError('')
    try {
      const updated = await updateIncident(confirm.incident.id, { status: confirm.next })
      if (!updated) throw new Error('The incident could not be updated.')
      setConfirm(null)
      onToast(`Incident ${confirm.incident.id} marked ${confirm.next.toLowerCase()}`)
    } catch (error) {
      setConfirmError(error.message || 'Unable to update the incident. Please try again.')
    } finally {
      setConfirmUpdating(false)
    }
  }

  const handleRescueDispatch = (e) => {
    e.preventDefault()
    updateRescueRequest(rescueDispatchModal.id, {
      assignedTeam: dispatchTeam,
      status: dispatchStatus,
    })
    onToast(`Assigned ${dispatchTeam} to rescue ticket ${rescueDispatchModal.id}`)
    setRescueDispatchModal(null)
  }

  const handleExportIncidents = () => {
    const columns = [
      { label: 'Incident ID', key: 'id' },
      { label: 'Disaster Type', key: 'type' },
      { label: 'Location', key: 'location' },
      { label: 'Severity', key: 'severity' },
      { label: 'Affected Count', key: 'affected' },
      { label: 'Status', key: 'status' },
      { label: 'Reporter', key: 'reporter' },
      { label: 'Contact', key: 'contact' },
      { label: 'Reported At', key: 'reportedAt' },
      { label: 'Assigned Team', key: 'team' },
    ]
    exportToCSV('resqcloud-incidents-report', filteredIncidents, columns)
    onToast('Incidents table exported to CSV')
  }

  const handleExportRescue = () => {
    const columns = [
      { label: 'Request ID', key: 'id' },
      { label: 'Citizen Name', key: 'citizenName' },
      { label: 'Contact', key: 'contact' },
      { label: 'Location', key: 'location' },
      { label: 'People Count', key: 'peopleCount' },
      { label: 'Medical Emergency', value: (r) => (r.medicalEmergency ? 'YES' : 'NO') },
      { label: 'Priority', key: 'priority' },
      { label: 'Status', key: 'status' },
      { label: 'Assigned Team', key: 'assignedTeam' },
      { label: 'Reported At', key: 'reportedAt' },
    ]
    exportToCSV('resqcloud-rescue-requests', filteredRescue, columns)
    onToast('Rescue queue exported to CSV')
  }

  return (
    <>
      <PageTitle
        eyebrow="INCIDENT RESPONSE & RESCUE"
        title="Incident Management"
        description="Verify incoming emergency reports, coordinate team dispatch, track rescue operations, and export reports."
        action={
          <div className="action-row">
            <button className="button button-secondary" onClick={activeTab === 'incidents' ? handleExportIncidents : handleExportRescue}>
              <Download size={15} /> Export CSV
            </button>
            <Link className="button button-primary" to="/report">
              <Plus size={16} /> Report Emergency
            </Link>
          </div>
        }
      />

      <div className="incident-summary-strip">
        <span><Siren size={16} /> <strong>{incidents.length}</strong> total incident reports</span>
        <span><LifeBuoy size={16} /> <strong>{rescueRequests.filter((r) => r.status !== 'Completed').length}</strong> active rescue tickets</span>
        <span><CheckCheck size={16} /> <strong>{incidents.filter((item) => item.status === 'Resolved').length}</strong> resolved</span>
        <span><Clock3 size={16} /> <strong>{incidents.filter((item) => ['Reported', 'Under Verification'].includes(item.status)).length}</strong> awaiting review</span>
      </div>

      <div className="tab-pill-bar">
        <button className={cx('tab-pill', activeTab === 'incidents' && 'active')} onClick={() => setActiveTab('incidents')}>
          <Siren size={15} /> Incident Reports Queue ({incidents.length})
        </button>
        <button className={cx('tab-pill', activeTab === 'rescue' && 'active')} onClick={() => setActiveTab('rescue')}>
          <LifeBuoy size={15} /> Rescue Requests Queue ({rescueRequests.length})
        </button>
      </div>

      {activeTab === 'incidents' ? (
        <Panel title="Incident Reports" subtitle={`${filteredIncidents.length} reports match current filters`}>
          <div className="table-filters page-filters">
            <label className="search-box">
              <Search size={15} />
              <input
                placeholder="Search ID, type, location, reporter..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select aria-label="Filter severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option>All severity</option>
              {['Critical', 'High', 'Medium', 'Low'].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select aria-label="Filter status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option>All status</option>
              {statusOptions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select
              aria-label="Sort table"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="reportedAt">Sort: Reported Date</option>
              <option value="severity">Sort: Severity</option>
              <option value="affected">Sort: People Affected</option>
            </select>
          </div>

          {!filteredIncidents.length ? (
            <EmptyState title="No matching incidents" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Incident</th>
                    <th>Disaster type</th>
                    <th>Location</th>
                    <th>Severity</th>
                    <th>Reported</th>
                    <th>Status</th>
                    <th>Reporter</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIncidents.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <button className="table-link" onClick={() => setSelected(item)}>
                          {item.id}
                        </button>
                        <small className="cell-sub">{formatNumber(item.affected)} affected</small>
                      </td>
                      <td>{item.type}</td>
                      <td>{item.location}</td>
                      <td><Badge>{item.severity}</Badge></td>
                      <td>{timeAgo(item.reportedAt)}</td>
                      <td><Badge>{item.status}</Badge></td>
                      <td>{item.reporter}</td>
                      <td>
                        <button className="button button-small button-secondary" onClick={() => setSelected(item)}>
                          Review
                        </button>
                        {user.role === 'Authority Administrator' && !['Resolved', 'Rejected'].includes(item.status) && (
                          <button
                            className="icon-button row-action"
                            title="Mark resolved"
                            aria-label={`Mark ${item.id} resolved`}
                            onClick={() => {
                              setConfirmError('')
                              setConfirm({ incident: item, next: 'Resolved' })
                            }}
                          >
                            <Check size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : (
        <Panel title="Rescue & Evacuation Requests" subtitle={`${filteredRescue.length} citizens awaiting search & rescue dispatch`}>
          <div className="table-filters page-filters">
            <label className="search-box">
              <Search size={15} />
              <input
                placeholder="Search citizen name or location..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>

          {!filteredRescue.length ? (
            <EmptyState title="No rescue requests in queue" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Request ID</th>
                    <th>Citizen</th>
                    <th>Contact</th>
                    <th>Location</th>
                    <th>People</th>
                    <th>Medical Need</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Assigned Team</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRescue.map((req) => (
                    <tr key={req.id}>
                      <td className="table-id">{req.id}</td>
                      <td><strong>{req.citizenName}</strong></td>
                      <td>{req.contact}</td>
                      <td>{req.location}</td>
                      <td><strong>{req.peopleCount}</strong></td>
                      <td>{req.medicalEmergency ? <Badge tone="Critical">Urgent Medical</Badge> : <span className="muted">Standard</span>}</td>
                      <td><Badge>{req.priority}</Badge></td>
                      <td><Badge>{req.status}</Badge></td>
                      <td>{req.assignedTeam ? <span className="team-tag"><Truck size={13} /> {req.assignedTeam}</span> : <span className="muted">Unassigned</span>}</td>
                      <td>
                        <button
                          className="button button-small button-primary"
                          onClick={() => {
                            setRescueDispatchModal(req)
                            setDispatchTeam(req.assignedTeam || 'River Rescue Unit')
                            setDispatchStatus(req.status === 'Pending' ? 'In Progress' : req.status)
                          }}
                        >
                          Dispatch Team
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* Rescue Dispatch Modal */}
      {rescueDispatchModal && (
        <Modal title={`Dispatch Rescue Team · Ticket ${rescueDispatchModal.id}`} onClose={() => setRescueDispatchModal(null)}>
          <form className="form-stack modal-form" onSubmit={handleRescueDispatch}>
            <p className="modal-description-copy">
              Citizen <strong>{rescueDispatchModal.citizenName}</strong> at <strong>{rescueDispatchModal.location}</strong> ({rescueDispatchModal.peopleCount} people stranded).
            </p>
            <Field label="Assign Emergency Response Unit">
              <select value={dispatchTeam} onChange={(e) => setDispatchTeam(e.target.value)}>
                <option>River Rescue Unit</option>
                <option>Urban Search & Rescue</option>
                <option>Medical Response Team</option>
                <option>Rapid Relief Team</option>
              </select>
            </Field>
            <Field label="Update Rescue Status">
              <select value={dispatchStatus} onChange={(e) => setDispatchStatus(e.target.value)}>
                <option>Assigned</option>
                <option>In Progress</option>
                <option>Completed</option>
                <option>Pending</option>
              </select>
            </Field>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setRescueDispatchModal(null)}>
                Cancel
              </button>
              <button type="submit" className="button button-primary">
                Save & Dispatch
              </button>
            </div>
          </form>
        </Modal>
      )}

      {selected && <IncidentDialog incident={selected} onClose={() => setSelected(null)} onToast={onToast} />}

      {confirm && (
        <Modal title="Confirm incident update" onClose={() => !confirmUpdating && setConfirm(null)}>
          <p className="confirm-copy">
            Mark <strong>{confirm.incident.id}</strong> as <strong>{confirm.next}</strong>? This status will be saved to the backend.
          </p>
          {confirmUpdating && <div className="incident-data-banner" role="status">Saving incident status…</div>}
          {confirmError && <div className="error-banner" role="alert">{confirmError}</div>}
          <div className="modal-actions">
            <button className="button button-secondary" disabled={confirmUpdating} onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="button button-primary" disabled={confirmUpdating} onClick={confirmStatus}>
              {confirmUpdating ? 'Saving…' : 'Confirm Update'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

// ============================================================================
// REPORT EMERGENCY PAGE
// ============================================================================
function ReportPage({ onToast }) {
  const { addIncident, user } = useApp()
  const [form, setForm] = useState({
    type: '',
    description: '',
    location: '',
    affected: '',
    severity: 'Medium',
    reporter: user?.name || '',
    contact: user?.phone || '',
    lat: '',
    lng: '',
  })
  const [image, setImage] = useState('')
  const [imageProcessing, setImageProcessing] = useState(false)
  const [errors, setErrors] = useState({})
  const [created, setCreated] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event) => {
    event.preventDefault()
    if (imageProcessing) {
      setErrors((current) => ({ ...current, image: 'Wait for image preparation to finish before submitting.' }))
      return
    }
    const next = {}
    if (!form.type) next.type = 'Choose the disaster type.'
    if (!form.description.trim()) next.description = 'Add a short description of what happened.'
    if (!form.location.trim()) next.location = 'Enter a location or nearby landmark.'
    if (form.affected === '' || !Number.isInteger(Number(form.affected)) || Number(form.affected) < 0) {
      next.affected = 'Enter a whole number of zero or more.'
    }
    if (!form.reporter.trim()) next.reporter = 'Enter the name of the person reporting.'
    if (form.contact && !/^[+\d][\d\s()-]{5,18}$/.test(form.contact)) {
      next.contact = 'Enter a valid phone number.'
    }
    if (
      Boolean(form.lat) !== Boolean(form.lng) ||
      (form.lat && (!Number.isFinite(Number(form.lat)) || Number(form.lat) < -90 || Number(form.lat) > 90)) ||
      (form.lng && (!Number.isFinite(Number(form.lng)) || Number(form.lng) < -180 || Number(form.lng) > 180))
    ) {
      next.coordinates = 'Enter both valid latitude and longitude values, or leave both blank.'
    }
    setErrors(next)
    if (Object.keys(next).length) return

    setSubmitting(true)
    try {
      const id = await addIncident({
        ...form,
        affected: Number(form.affected),
        lat: form.lat ? Number(form.lat) : undefined,
        lng: form.lng ? Number(form.lng) : undefined,
      })
      setCreated(id)
      onToast(`Emergency report submitted · ${id}`)
    } catch (requestError) {
      setErrors((current) => ({ ...current, general: requestError.message || 'Unable to submit the report. Please try again.' }))
    } finally {
      setSubmitting(false)
    }
  }

  const error = (key) => errors[key] && <small className="field-error">{errors[key]}</small>

  return (
    <>
      <PageTitle
        eyebrow="COMMUNITY REPORTING"
        title="Report an Emergency"
        description="Share what is happening so response teams can immediately assess, dispatch, and coordinate support."
      />

      {created && (
        <div className="success-banner">
          <span className="success-banner-icon">
            <Check size={18} />
          </span>
          <div>
            <strong>Report received — Reference ticket {created}</strong>
            <span>Your incident is now in the response command queue. An incident coordinator will review the details.</span>
          </div>
          <Link to="/">View on Dashboard <ArrowRight size={14} /></Link>
        </div>
      )}

      <div className="report-layout">
        <form className="panel report-form" onSubmit={submit} noValidate>
          <div className="form-section-heading">
            <span className="form-step">01</span>
            <div>
              <h2>Incident details</h2>
              <p>Tell us what disaster has occurred and how urgent the situation is.</p>
            </div>
          </div>

          <div className="form-grid">
            <Field label="Disaster type">
              <select className={errors.type ? 'invalid' : ''} value={form.type} onChange={(e) => set('type', e.target.value)}>
                <option value="">Select disaster type</option>
                {typeOptions.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              {error('type')}
            </Field>

            <Field label="Severity">
              <select value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                {['Low', 'Medium', 'High', 'Critical'].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </Field>

            <Field label="Description">
              <textarea
                className={errors.description ? 'invalid' : ''}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Describe the emergency, visible impact, and immediate needs..."
                rows={4}
              />
              {error('description')}
            </Field>

            <Field label="Location or nearby landmark">
              <input
                className={errors.location ? 'invalid' : ''}
                value={form.location}
                onChange={(e) => set('location', e.target.value)}
                placeholder="e.g. Assi Ghat Lane 4, Varanasi"
              />
              {error('location')}
            </Field>

            <Field label="Estimated people affected" hint="Estimate is okay. Enter 0 if unknown.">
              <input
                className={errors.affected ? 'invalid' : ''}
                type="number"
                min="0"
                step="1"
                value={form.affected}
                onChange={(e) => set('affected', e.target.value)}
                placeholder="Number of people"
              />
              {error('affected')}
            </Field>
          </div>

          <details className="coordinate-details">
            <summary>
              <Map size={15} /> Add optional map coordinates <ChevronDown size={14} />
            </summary>
            <p>Only add coordinates if you already know them. Your device location is never tracked without consent.</p>
            <div className="form-grid">
              <Field label="Latitude">
                <input
                  type="number"
                  min="-90"
                  max="90"
                  step="any"
                  value={form.lat}
                  onChange={(e) => set('lat', e.target.value)}
                  placeholder="e.g. 25.2895"
                />
              </Field>
              <Field label="Longitude">
                <input
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
                  value={form.lng}
                  onChange={(e) => set('lng', e.target.value)}
                  placeholder="e.g. 83.0068"
                />
              </Field>
            </div>
            {error('coordinates')}
          </details>

          <div className="form-divider" />

          <div className="form-section-heading">
            <span className="form-step">02</span>
            <div>
              <h2>Contact & evidence</h2>
              <p>Your report is linked to your authenticated account.</p>
            </div>
          </div>

          <div className="form-grid">
            <Field label="Your name">
              <input value={user?.name || ''} readOnly />
            </Field>

            <Field label="Account email">
              <input value={user?.email || ''} readOnly />
            </Field>

            <Field label="Photo evidence (optional)">
              <input
                className="file-input"
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setImage('')
                  setImageProcessing(true)
                  setErrors((current) => ({ ...current, image: '' }))
                  compressIncidentImage(file)
                    .then(setImage)
                    .catch((error) => setErrors((current) => ({ ...current, image: error.message })))
                    .finally(() => setImageProcessing(false))
                }}
              />
              {imageProcessing && <small>Compressing evidence image for local storage…</small>}
              {errors.image && error('image')}
              {image && <small>Photo evidence is previewed locally but is not uploaded to the backend yet.</small>}
              {image && <img className="upload-preview" src={image} alt="Selected incident evidence" />}
            </Field>
          </div>

          <div className="report-submit">
            <span>
              <Shield size={15} /> Your report is shared across the ResQCloud response network.
            </span>
            {errors.general && <small className="field-error" role="alert">{errors.general}</small>}
            <button className="button button-primary" type="submit" disabled={imageProcessing || submitting}>
              <Siren size={16} /> {imageProcessing ? 'Preparing Evidence…' : submitting ? 'Submitting Report…' : 'Submit Emergency Report'}
            </button>
          </div>
        </form>

        <aside className="report-aside">
          <div className="report-aside-icon">
            <LifeBuoy size={19} />
          </div>
          <h2>When every moment matters</h2>
          <p>Incident details are sent to the ResQCloud backend. Other response workflows remain local to this browser.</p>
          <div className="aside-divider" />
          <strong>Direct Emergency Call</strong>
          <span>Dial 112 for Police, Fire, and Ambulance unified response.</span>
          <div className="safe-note">
            <ShieldAlert size={16} />
            <span>Never put yourself at danger to capture photos or incident details.</span>
          </div>
        </aside>
      </div>
    </>
  )
}

// ============================================================================
// LIVE INCIDENT MAP
// ============================================================================
function MapPage({ globalSearch }) {
  const { incidents } = useApp()
  const [type, setType] = useState('All types')
  const [severity, setSeverity] = useState('All severity')
  const [status, setStatus] = useState('All status')
  const [tilesLoaded, setTilesLoaded] = useState(false)
  const [tilesFailed, setTilesFailed] = useState(false)
  const [selected, setSelected] = useState(null)
  const loc = useLocation()
  const focusId = new URLSearchParams(loc.search).get('incident')
  const search = (globalSearch || '').trim().toLowerCase()

  const matching = incidents.filter(
    (item) =>
      (!search || `${item.id} ${item.type} ${item.location} ${item.reporter || ''}`.toLowerCase().includes(search)) &&
      (type === 'All types' || item.type === type) &&
      (severity === 'All severity' || item.severity === severity) &&
      (status === 'All status' || item.status === status)
  )
  const filtered = matching.filter(hasCoordinates)

  const markerIcon = (item) =>
    L.divIcon({
      className: 'map-marker-wrap',
      html: `<span class="map-marker map-marker-${item.severity.toLowerCase()}"></span>`,
      iconSize: [23, 23],
      iconAnchor: [11, 11],
    })

  return (
    <>
      <PageTitle
        eyebrow="SITUATIONAL AWARENESS"
        title="Live Incident Map"
        description="Filter and track geolocated emergencies across regions in real time."
        action={
          <span className="map-live-label">
            <span className="status-dot" /> LIVE INCIDENT RADAR
          </span>
        }
      />

      <div className="map-filters panel">
        <div className="map-filter-title">
          <Filter size={16} />
          <strong>Map Filters</strong>
        </div>
        <select aria-label="Filter map by disaster type" value={type} onChange={(e) => setType(e.target.value)}>
          <option>All types</option>
          {typeOptions.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select aria-label="Filter map by severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option>All severity</option>
          {['Critical', 'High', 'Medium', 'Low'].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select aria-label="Filter map by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option>All status</option>
          {statusOptions.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <span className="map-match-count">{filtered.length} mapped incidents</span>
      </div>

      <section className="map-panel panel">
        <div className="map-disclaimer">
          <ShieldAlert size={15} />
          <span>Interactive geospatial radar. Pulse markers indicate high-priority active responses.</span>
        </div>
        {tilesFailed && (
          <div className="map-warning">
            <AlertTriangle size={15} /> Map tiles could not load. Incident coordinates remain listed in the table below.
          </div>
        )}
        {!tilesLoaded && !tilesFailed && (
          <div className="map-loading" role="status">
            <span className="loading-spinner" /> Loading OpenStreetMap tiles…
          </div>
        )}
        <div className="leaflet-map">
          <MapContainer
            center={[22.8, 79.2]}
            zoom={5}
            scrollWheelZoom
            className="leaflet-canvas"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              eventHandlers={{
                load: () => setTilesLoaded(true),
                tileerror: () => {
                  setTilesFailed(true)
                  setTilesLoaded(true)
                },
              }}
            />
            {filtered.map((item) => (
              <Marker
                key={item.id}
                position={[item.lat, item.lng]}
                icon={markerIcon(item)}
                eventHandlers={{ click: () => setSelected(item) }}
              >
                <Popup>
                  <div className="map-popup">
                    <strong>{item.id} · {item.type}</strong>
                    <span>{item.location}</span>
                    <Badge>{item.severity}</Badge>
                    <button onClick={() => setSelected(item)}>Open Incident Details</button>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
          {!filtered.length && <div className="map-empty-overlay">No mapped incidents match the selected filters.</div>}
        </div>
        <div className="map-legend">
          <strong>SEVERITY</strong>
          {['Critical', 'High', 'Medium', 'Low'].map((item) => (
            <span key={item}>
              <i className={`severity-dot ${item.toLowerCase()}-dot`} />
              {item}
            </span>
          ))}
        </div>
      </section>

      {matching.length > filtered.length && (
        <div className="map-unlocated-note">
          <Map size={14} /> {matching.length - filtered.length} matching report
          {matching.length - filtered.length === 1 ? ' has' : 's have'} no GPS coordinates and{' '}
          {matching.length - filtered.length === 1 ? 'is' : 'are'} listed below.
        </div>
      )}

      <Panel title="Incident reports list" subtitle={`${matching.length} reports match the selected filters`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Incident</th>
                <th>Type</th>
                <th>Location</th>
                <th>Severity</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {matching.map((item) => (
                <tr className={focusId === item.id ? 'focused-row' : ''} key={item.id}>
                  <td>
                    <button className="table-link" onClick={() => setSelected(item)}>
                      {item.id}
                    </button>
                  </td>
                  <td>{item.type}</td>
                  <td>
                    {item.location}
                    {!hasCoordinates(item) && <small className="cell-sub">Coordinates not provided</small>}
                  </td>
                  <td><Badge>{item.severity}</Badge></td>
                  <td><Badge>{item.status}</Badge></td>
                  <td>
                    <button className="button button-small button-secondary" onClick={() => setSelected(item)}>
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!matching.length && <EmptyState title="No matching incidents" message="Try different filters or report a new emergency." />}
      </Panel>

      {selected && <IncidentDialog incident={selected} onClose={() => setSelected(null)} onToast={() => {}} />}
    </>
  )
}

// ============================================================================
// SHELTER MANAGEMENT PAGE (ROLE-AWARE ACCESS & CSV EXPORT)
// ============================================================================
function SheltersPage({ onToast }) {
  const { shelters, users, addShelter, updateShelter, user } = useApp()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('All status')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({
    name: '',
    address: '',
    location: '',
    capacity: '',
    occupancy: '0',
    facilities: '',
    status: 'Operational',
    managerId: '',
  })
  const [error, setError] = useState('')

  const isCitizen = user.role === 'Citizen'
  const isShelterManager = user.role === 'Shelter Manager'
  const isAdmin = user.role === 'Authority Administrator'
  const assignedShelter = isShelterManager ? findAssignedShelter(shelters, user) : null

  const filtered = shelters.filter(
    (item) =>
      `${item.name} ${item.id} ${item.address} ${item.location}`.toLowerCase().includes(query.toLowerCase()) &&
      (status === 'All status' || item.status === status)
  )

  const openForm = (shelter) => {
    setForm(
      shelter
        ? { ...shelter, facilities: shelter.facilities.join(', ') }
        : { name: '', address: '', location: '', capacity: '', occupancy: '0', facilities: '', status: 'Operational', managerId: '' }
    )
    setError('')
    setModal(shelter || 'new')
  }

  const save = (e) => {
    e.preventDefault()
    const capacity = Number(form.capacity)
    const occupancy = Number(form.occupancy)
    if (
      !form.name.trim() ||
      !form.address.trim() ||
      !form.location.trim() ||
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      !Number.isInteger(occupancy) ||
      occupancy < 0 ||
      occupancy > capacity
    ) {
      setError('Enter shelter details and a whole-number occupancy between 0 and total capacity.')
      return
    }
    const currentShelterId = modal === 'new' ? undefined : modal.id
    if (!isShelterManagerAssignmentValid(users, shelters, form.managerId || '', currentShelterId)) {
      setError('Choose an unassigned user with the Shelter Manager role.')
      return
    }
    const assignedManager = users.find((item) => item.id === form.managerId && item.role === 'Shelter Manager')
    const value = {
      ...form,
      capacity,
      occupancy,
      facilities: form.facilities.split(',').map((item) => item.trim()).filter(Boolean),
      managerId: form.managerId || '',
      manager: assignedManager?.name || (modal !== 'new' && form.managerId === modal.managerId ? modal.manager : ''),
    }
    if (modal === 'new') {
      if (!addShelter(value)) {
        setError('Only an authority administrator can add shelters.')
        return
      }
    } else {
      if (!updateShelter(modal.id, value)) {
        setError('You are not assigned to manage this shelter.')
        return
      }
    }
    setModal(null)
    onToast(modal === 'new' ? 'Shelter added' : 'Shelter details updated')
  }

  const updateOccupancy = (shelter, delta) => {
    const occupancy = shelter.occupancy + delta
    if (occupancy < 0 || occupancy > shelter.capacity) return
    if (!updateShelter(shelter.id, { occupancy })) {
      onToast('You are not assigned to manage this shelter.')
      return
    }
    onToast(`Occupancy updated for ${shelter.name}`)
  }

  const handleExportCSV = () => {
    const columns = [
      { label: 'Shelter ID', key: 'id' },
      { label: 'Shelter Name', key: 'name' },
      { label: 'Manager', key: 'manager' },
      { label: 'Address', key: 'address' },
      { label: 'Location', key: 'location' },
      { label: 'Capacity', key: 'capacity' },
      { label: 'Occupancy', key: 'occupancy' },
      { label: 'Available Beds', value: (s) => Math.max(0, s.capacity - s.occupancy) },
      { label: 'Status', key: 'status' },
      { label: 'Facilities', value: (s) => (s.facilities || []).join(', ') },
    ]
    exportToCSV('resqcloud-shelters-directory', filtered, columns)
    onToast('Shelters directory exported to CSV')
  }
  const managerOptions = users.filter(
    (candidate) =>
      candidate.role === 'Shelter Manager' &&
      !shelters.some((item) => item.id !== (modal?.id || '') && item.managerId === candidate.id)
  )

  return (
    <>
      <PageTitle
        eyebrow="RELIEF SHELTER NETWORK"
        title="Shelter Management & Directory"
        description={
          isCitizen
            ? 'Find nearby safe shelters, check live bed capacity, and inspect available facilities.'
            : 'Monitor shelter capacity, update bed occupancy, track arrivals, and maintain relief hubs.'
        }
        action={
          <div className="action-row">
            <button className="button button-secondary" onClick={handleExportCSV}>
              <Download size={15} /> Export CSV
            </button>
            {isAdmin && (
              <button className="button button-primary" onClick={() => openForm(null)}>
                <Plus size={16} /> Add Shelter
              </button>
            )}
          </div>
        }
      />

      {isCitizen && (
        <div className="citizen-notice">
          <Home size={17} />
          <div>
            <strong>Citizen Relief Directory View</strong>
            <span>All shelters marked Operational are currently accepting evacuees. Medical aid and meals are noted under facilities.</span>
          </div>
        </div>
      )}

      {isShelterManager && (
        <div className="shelter-assignment-note">
          <Home size={15} />
          <span>{assignedShelter ? `You have operational control over ${assignedShelter.name}. Other network centres are displayed in read-only mode.` : 'No shelter is assigned to your account. Shelter-specific updates are disabled until an administrator assigns one.'}</span>
        </div>
      )}

      <div className="stats-grid compact-stats">
        <StatCard label="Total relief centres" value={shelters.length} note="registered locations" icon={Home} color="blue" />
        <StatCard label="Operational now" value={shelters.filter((item) => item.status === 'Operational').length} note="accepting evacuees" icon={CheckCheck} color="green" />
        <StatCard
          label="Total available beds"
          value={formatNumber(
            shelters
              .filter((item) => item.status === 'Operational')
              .reduce((sum, item) => sum + Math.max(0, item.capacity - item.occupancy), 0)
          )}
          note="across operational centres"
          icon={Users}
          color="orange"
        />
        <StatCard
          label="Near capacity"
          value={
            shelters.filter(
              (item) => item.status === 'Operational' && (item.capacity - item.occupancy) / item.capacity <= 0.15
            ).length
          }
          note="less than 15% beds remaining"
          icon={AlertTriangle}
          color="red"
        />
      </div>

      <Panel title="Shelter Locations & Availability" subtitle="Capacity and operational status across the network">
        <div className="table-filters page-filters">
          <label className="search-box">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search shelters, cities, or landmarks" />
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter shelter status">
            <option>All status</option>
            {['Operational', 'Standby', 'Maintenance'].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>

        <div className="shelter-grid">
          {filtered.map((item) => {
            const pct = Math.round((item.occupancy / item.capacity) * 100)
            const available = Math.max(0, item.capacity - item.occupancy)
            const canEdit = isAdmin || (isShelterManager && item.managerId === user.id)

            return (
              <article className="shelter-card" key={item.id}>
                <div className="shelter-card-top">
                  <div className="shelter-icon">
                    <Home size={18} />
                  </div>
                  {canEdit && (
                    <button className="icon-button" aria-label={`Edit ${item.name}`} onClick={() => openForm(item)}>
                      <MoreHorizontal size={18} />
                    </button>
                  )}
                </div>

                <div className="shelter-id">
                  {item.id} <Badge>{item.status}</Badge>
                </div>

                <h3>{item.name}</h3>
                <p className="shelter-address">{item.address} · {item.location}</p>
                {item.manager && <small className="cell-sub">Managed by: {item.manager}</small>}

                <div className="shelter-capacity-label">
                  <span>Capacity used</span>
                  <strong>{item.occupancy} <small>/ {item.capacity}</small></strong>
                </div>

                <div className="progress-track capacity-progress">
                  <i className={pct >= 85 ? 'progress-warn' : ''} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>

                <div className="shelter-bed-line">
                  <span className={available <= item.capacity * 0.15 ? 'bed-warning' : 'bed-good'}>
                    {available} beds available
                  </span>
                  <span>{pct}% occupied</span>
                </div>

                <div className="facility-list">
                  {item.facilities.map((facility) => (
                    <span key={facility}>{facility}</span>
                  ))}
                </div>

                {canEdit && (
                  <div className="occupancy-actions">
                    <button
                      className="button button-small button-secondary"
                      onClick={() => updateOccupancy(item, -1)}
                      disabled={item.occupancy <= 0}
                    >
                      −1
                    </button>
                    <span>Update beds</span>
                    <button
                      className="button button-small button-secondary"
                      onClick={() => updateOccupancy(item, 1)}
                      disabled={item.occupancy >= item.capacity}
                    >
                      +1
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>

        {!filtered.length && <EmptyState title="No shelters found" />}
      </Panel>

      {/* Edit / Add Shelter Modal */}
      {modal && (
        <Modal title={modal === 'new' ? 'Add a Shelter' : 'Edit Shelter Details'} onClose={() => setModal(null)}>
          <form className="modal-form form-stack" onSubmit={save}>
            <Field label="Shelter name">
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Address">
              <input required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label="City / Location">
              <input required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </Field>
            <div className="form-grid">
              <Field label="Total capacity">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.capacity}
                  onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                />
              </Field>
              <Field label="Current occupancy">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.occupancy}
                  onChange={(e) => setForm({ ...form, occupancy: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Facilities (comma-separated)">
              <input
                value={form.facilities}
                onChange={(e) => setForm({ ...form, facilities: e.target.value })}
                placeholder="Medical aid, Meals, Accessible, Family rooms"
              />
            </Field>
            {isAdmin && (
              <Field label="Assigned shelter manager">
                <select value={form.managerId || ''} onChange={(e) => setForm({ ...form, managerId: e.target.value })}>
                  <option value="">Unassigned</option>
                  {modal !== 'new' &&
                    modal.managerId &&
                    !users.some((item) => item.id === modal.managerId) && (
                      <option value={modal.managerId}>Existing unregistered assignment</option>
                    )}
                  {managerOptions.map((manager) => (
                    <option key={manager.id} value={manager.id}>{manager.name}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Operational status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {['Operational', 'Standby', 'Maintenance'].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </Field>
            {error && <small className="field-error">{error}</small>}
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button className="button button-primary">{modal === 'new' ? 'Add Shelter' : 'Save Changes'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

// ============================================================================
// RESOURCE MANAGEMENT PAGE (ADMIN APPROVALS & DISPATCH)
// ============================================================================
function ResourcesPage({ onToast }) {
  const {
    resources,
    resourceRequests,
    shelters,
    transactions,
    addResource,
    updateResource,
    approveResourceRequest,
    dispatchResourceRequest,
    dispatchResource,
    user,
  } = useApp()

  const isAdmin = user.role === 'Authority Administrator'
  const isShelterManager = user.role === 'Shelter Manager'
  const assignedShelter = isShelterManager ? findAssignedShelter(shelters, user) : null
  const visibleResources = isShelterManager
    ? resources.filter((item) => item.shelter === assignedShelter?.name)
    : resources
  const visibleRequests = isShelterManager
    ? resourceRequests.filter((item) => item.shelter === assignedShelter?.name)
    : resourceRequests
  const visibleTransactions = isShelterManager
    ? transactions.filter((item) => item.shelter === assignedShelter?.name)
    : transactions

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All items')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ item: 'Food packets', quantity: '', shelter: assignedShelter?.name || '' })
  const [error, setError] = useState('')

  const low = visibleResources.filter((item) => item.quantity <= 50)
  const filtered = visibleResources.filter(
    (item) =>
      `${item.id} ${item.item} ${item.shelter}`.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'All items' || (filter === 'Low stock' ? item.quantity <= 50 : item.item === filter))
  )

  const open = (mode, item) => {
    setForm(item ? { ...item, quantity: mode === 'dispatch' ? '' : String(item.quantity) } : { item: 'Food packets', quantity: '', shelter: assignedShelter?.name || '' })
    setError('')
    setModal({ mode, item })
  }

  const save = (e) => {
    e.preventDefault()
    const quantity = Number(form.quantity)
    if (
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      (modal.mode === 'dispatch' && quantity < 1) ||
      (modal.mode === 'dispatch' && quantity > modal.item.quantity)
    ) {
      setError(modal.mode === 'dispatch' ? 'Enter a whole number between 1 and available stock.' : 'Enter a non-negative whole number.')
      return
    }
    if (!shelters.some((shelter) => shelter.name === form.shelter)) {
      setError('Select a registered shelter.')
      return
    }

    if (modal.mode === 'add') {
      if (!addResource({ ...form, quantity })) {
        setError('Only an authority administrator can add inventory.')
        return
      }
    } else if (modal.mode === 'edit') {
      const ok = updateResource(modal.item.id, { quantity, shelter: form.shelter })
      if (!ok) {
        setError('Unable to update this quantity.')
        return
      }
    } else {
      const ok = dispatchResource(modal.item.id, quantity, form.shelter)
      if (!ok) {
        setError('Unable to dispatch this quantity.')
        return
      }
    }
    setModal(null)
    onToast(modal.mode === 'dispatch' ? 'Resource dispatch recorded' : modal.mode === 'add' ? 'Resource added to inventory' : 'Inventory quantity updated')
  }

  const handleExportCSV = () => {
    const columns = [
      { label: 'Resource ID', key: 'id' },
      { label: 'Item Name', key: 'item' },
      { label: 'Quantity Available', key: 'quantity' },
      { label: 'Shelter / Depot', key: 'shelter' },
      { label: 'Last Updated', key: 'updatedAt' },
    ]
    exportToCSV('resqcloud-relief-inventory', filtered, columns)
    onToast('Relief inventory exported to CSV')
  }

  return (
    <>
      <PageTitle
        eyebrow="RELIEF INVENTORY & ALLOCATION"
        title="Resource Management"
        description="Oversee critical supplies, manage shelter supply requests, and record allocations across disaster hubs."
        action={
          <div className="action-row">
            <button className="button button-secondary" onClick={handleExportCSV}>
              <Download size={15} /> Export Inventory
            </button>
            {isAdmin && (
              <button className="button button-primary" onClick={() => open('add')}>
                <Plus size={16} /> Add Resource Lot
              </button>
            )}
          </div>
        }
      />

      {isShelterManager && !assignedShelter && (
        <div className="warning-banner" role="status">
          <AlertTriangle size={17} />
          <div><strong>No shelter is assigned</strong><span>Shelter-specific resource requests and receipt updates are unavailable until an administrator assigns a shelter to your account.</span></div>
        </div>
      )}

      <div className="stats-grid compact-stats">
        <StatCard label="Inventory records" value={visibleResources.length} note="tracked supply lots" icon={Boxes} color="blue" />
        <StatCard label="Units in inventory" value={formatNumber(visibleResources.reduce((sum, item) => sum + item.quantity, 0))} note={isShelterManager ? 'at your assigned shelter' : 'across all categories'} icon={Package} color="green" />
        <StatCard label="Low-stock alerts" value={low.length} note="50 units or fewer on hand" icon={AlertTriangle} color="red" />
        <StatCard label="Dispatches recorded" value={visibleTransactions.filter((item) => item.change < 0).length} note="supply movements" icon={Truck} color="orange" />
      </div>

      {low.length > 0 && (
        <div className="warning-banner">
          <AlertTriangle size={17} />
          <div>
            <strong>{low.length} supply record{low.length === 1 ? ' needs' : 's need'} replenishment</strong>
            <span>{low.map((item) => `${item.item} (${item.quantity} at ${item.shelter})`).join(' · ')}</span>
          </div>
        </div>
      )}

      {/* Pending Resource Requests Table */}
      <Panel
        title="Shelter Supply Requests Queue"
        subtitle={`${visibleRequests.filter((item) => item.status === 'Pending').length} requests awaiting authority review`}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Request ID</th>
                <th>Requested Item</th>
                <th>Quantity</th>
                <th>Shelter Hub</th>
                <th>Priority</th>
                <th>Requested</th>
                <th>Status</th>
                {isAdmin && <th>Admin Action</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRequests.map((item) => (
                <tr key={item.id}>
                  <td className="table-id">{item.id}</td>
                  <td><strong>{item.item}</strong></td>
                  <td>{formatNumber(item.quantity)}</td>
                  <td>{item.shelter}</td>
                  <td><Badge>{item.priority}</Badge></td>
                  <td>{timeAgo(item.at)}</td>
                  <td><Badge>{item.status}</Badge></td>
                  {isAdmin && (
                    <td>
                      {item.status === 'Pending' && (
                        <div className="action-row">
                          <button
                            className="button button-small button-secondary"
                            onClick={() => {
                              approveResourceRequest(item.id, 'Approved')
                              onToast(`Request ${item.id} approved`)
                            }}
                          >
                            Approve
                          </button>
                          <button
                            className="button button-small button-primary dispatch-button"
                            onClick={() => {
                              dispatchResourceRequest(item.id)
                              onToast(`Supplies for ${item.id} marked Dispatched`)
                            }}
                          >
                            Dispatch
                          </button>
                          <button
                            className="button button-small button-danger-outline"
                            onClick={() => {
                              approveResourceRequest(item.id, 'Declined')
                              onToast(`Request ${item.id} declined`)
                            }}
                          >
                            Decline
                          </button>
                        </div>
                      )}
                      {item.status === 'Approved' && (
                        <button
                          className="button button-small button-primary"
                          onClick={() => {
                            dispatchResourceRequest(item.id)
                            onToast(`Supplies for ${item.id} dispatched to ${item.shelter}`)
                          }}
                        >
                          <Truck size={14} /> Dispatch Shipment
                        </button>
                      )}
                      {item.status === 'Dispatched' && <span className="muted">In Transit to Shelter</span>}
                      {item.status === 'Received' && <span className="cell-sub">✓ Received by Shelter</span>}
                      {item.status === 'Declined' && <span className="muted">Declined</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visibleRequests.length && <EmptyState title="No supply requests" message={isShelterManager ? 'Requests for your assigned shelter will appear here.' : 'New requests submitted by shelters will appear here.'} />}
      </Panel>

      {/* Relief Inventory Table */}
      <Panel title="Relief Supplies Inventory" subtitle={`${filtered.length} resource inventory records`}>
        <div className="table-filters page-filters">
          <label className="search-box">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search items, IDs, or shelters" />
          </label>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter resource records">
            <option>All items</option>
            <option>Low stock</option>
            {['Food packets', 'Drinking water', 'Medicines', 'Blankets', 'First-aid kits', 'Rescue equipment'].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>

        {filtered.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Item type</th>
                  <th>Quantity</th>
                  <th>Shelter / Depot</th>
                  <th>Last updated</th>
                  <th>Stock status</th>
                  {isAdmin && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td className="table-id">{item.id}</td>
                    <td>
                      <span className="type-cell">
                        <Package size={15} />
                        {item.item}
                      </span>
                    </td>
                    <td>
                      <strong className={item.quantity <= 50 ? 'quantity-low' : ''}>{formatNumber(item.quantity)}</strong>
                      <span className="muted"> units</span>
                    </td>
                    <td>{item.shelter}</td>
                    <td>{timeAgo(item.updatedAt)}</td>
                    <td>
                      {item.quantity <= 30 ? (
                        <Badge tone="Critical">Critical stock</Badge>
                      ) : item.quantity <= 50 ? (
                        <Badge tone="Medium">Low stock</Badge>
                      ) : (
                        <Badge tone="Resolved">In stock</Badge>
                      )}
                    </td>
                    {isAdmin && (
                      <td>
                        <button className="button button-small button-secondary" onClick={() => open('edit', item)}>
                          Edit
                        </button>
                        <button
                          className="button button-small button-secondary dispatch-button"
                          onClick={() => open('dispatch', item)}
                          disabled={!item.quantity}
                        >
                          Dispatch
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No resource records found" />
        )}
      </Panel>

      {/* Stock Transactions Log */}
      <Panel title="Recent Stock Transactions" subtitle="Detailed audit ledger of stock movements and confirmed receipts">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Transaction</th>
                <th>Item</th>
                <th>Quantity Change</th>
                <th>Shelter / Location</th>
                <th>Reason / Ledger Note</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {visibleTransactions.slice(0, 10).map((item) => (
                <tr key={item.id}>
                  <td className="table-id">{item.id}</td>
                  <td>{item.item}</td>
                  <td className={item.change < 0 ? 'quantity-low' : 'quantity-positive'}>
                    {item.change > 0 ? '+' : ''}
                    {formatNumber(item.change)}
                  </td>
                  <td>{item.shelter}</td>
                  <td>{item.note}</td>
                  <td>{timeAgo(item.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visibleTransactions.length && <EmptyState title="No transactions recorded" />}
      </Panel>

      {/* Add / Edit / Dispatch Modal */}
      {modal && (
        <Modal
          title={modal.mode === 'add' ? 'Add Resource Stock' : modal.mode === 'dispatch' ? `Dispatch ${modal.item.item}` : `Edit ${modal.item.item}`}
          onClose={() => setModal(null)}
        >
          <form className="form-stack modal-form" onSubmit={save}>
            {modal.mode === 'add' && (
              <Field label="Resource item">
                <select value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })}>
                  {['Food packets', 'Drinking water', 'Medicines', 'Blankets', 'First-aid kits', 'Rescue equipment'].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={modal.mode === 'dispatch' ? `Quantity to dispatch (available: ${modal.item.quantity})` : 'Quantity'}>
              <input
                type="number"
                min={modal.mode === 'dispatch' ? 1 : 0}
                step="1"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
            </Field>
            <Field label="Shelter / Target Location">
              <select value={form.shelter} onChange={(e) => setForm({ ...form, shelter: e.target.value })}>
                <option value="">Select a shelter</option>
                {shelters.map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
              </select>
            </Field>
            {error && <small className="field-error">{error}</small>}
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button className="button button-primary">
                {modal.mode === 'dispatch' ? 'Record Dispatch' : modal.mode === 'add' ? 'Add to Inventory' : 'Save Quantity'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

// ============================================================================
// VOLUNTEER COORDINATION PAGE (ADMIN DIRECTORY & TASK ASSIGNMENT)
// ============================================================================
function VolunteersPage({ onToast }) {
  const { volunteers, incidents, addVolunteer, addTask, updateTask, user } = useApp()
  const [query, setQuery] = useState('')
  const [availability, setAvailability] = useState('All availability')
  const [skill, setSkill] = useState('All skills')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ name: '', skills: '', contact: '', area: '', availability: 'Available' })
  const [task, setTask] = useState({ title: '', incidentId: incidents[0]?.id || '', priority: 'Medium', instructions: '' })
  const [error, setError] = useState('')

  const isAdmin = user.role === 'Authority Administrator'
  const skills = [...new Set(volunteers.flatMap((item) => item.skills))]

  const filtered = volunteers.filter(
    (item) =>
      `${item.name} ${item.id} ${item.area} ${item.skills.join(' ')}`.toLowerCase().includes(query.toLowerCase()) &&
      (availability === 'All availability' || item.availability === availability) &&
      (skill === 'All skills' || item.skills.includes(skill))
  )

  const openAdd = () => {
    setForm({ name: '', skills: '', contact: '', area: '', availability: 'Available' })
    setError('')
    setModal({ mode: 'add' })
  }

  const openTask = (volunteer) => {
    setTask({
      title: '',
      incidentId: incidents[0]?.id || '',
      priority: 'Medium',
      instructions: 'Report to site coordinator and assist with local operations.',
    })
    setError('')
    setModal({ mode: 'task', volunteer })
  }

  const save = (e) => {
    e.preventDefault()
    if (modal.mode === 'add') {
      if (!form.name.trim() || !form.contact.trim() || !form.area.trim() || !form.skills.trim()) {
        setError('Complete each field to register a volunteer.')
        return
      }
      addVolunteer({ ...form, skills: form.skills.split(',').map((item) => item.trim()).filter(Boolean) })
      onToast('Volunteer added to response network')
    } else {
      if (!task.title.trim()) {
        setError('Enter a task description.')
        return
      }
      addTask(modal.volunteer.id, { ...task })
      onToast(`Task assigned to ${modal.volunteer.name}`)
    }
    setModal(null)
  }

  const totals = volunteers.flatMap((item) => item.tasks)

  const handleExportCSV = () => {
    const columns = [
      { label: 'Volunteer ID', key: 'id' },
      { label: 'Name', key: 'name' },
      { label: 'Contact', key: 'contact' },
      { label: 'Service Area', key: 'area' },
      { label: 'Availability', key: 'availability' },
      { label: 'Skills', value: (v) => v.skills.join(', ') },
      { label: 'Active Tasks Count', value: (v) => v.tasks.filter((t) => t.status !== 'Completed').length },
      { label: 'Completed Tasks', value: (v) => v.tasks.filter((t) => t.status === 'Completed').length },
    ]
    exportToCSV('resqcloud-volunteers-roster', filtered, columns)
    onToast('Volunteer roster exported to CSV')
  }

  return (
    <>
      <PageTitle
        eyebrow="VOLUNTEER COMMAND"
        title="Volunteer Coordination"
        description="Review volunteer readiness, match specialist skills to disaster sites, and deploy response tasks."
        action={
          <div className="action-row">
            <button className="button button-secondary" onClick={handleExportCSV}>
              <Download size={15} /> Export CSV
            </button>
            {isAdmin && (
              <button className="button button-primary" onClick={openAdd}>
                <Plus size={16} /> Register Volunteer
              </button>
            )}
          </div>
        }
      />

      <div className="stats-grid compact-stats">
        <StatCard label="Registered volunteers" value={volunteers.length} note="in response roster" icon={Users} color="blue" />
        <StatCard label="Available now" value={volunteers.filter((item) => item.availability === 'Available').length} note="ready for assignment" icon={CheckCheck} color="green" />
        <StatCard label="Active tasks" value={totals.filter((item) => ['Assigned', 'In Progress'].includes(item.status)).length} note="underway in the field" icon={ClipboardList} color="orange" />
        <StatCard label="Tasks completed" value={totals.filter((item) => item.status === 'Completed').length} note="across all shifts" icon={Activity} color="purple" />
      </div>

      <Panel title="Volunteer Directory" subtitle={`${filtered.length} registered profiles`}>
        <div className="table-filters page-filters">
          <label className="search-box">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, skill, or service area" />
          </label>
          <select value={availability} onChange={(e) => setAvailability(e.target.value)} aria-label="Filter volunteer availability">
            <option>All availability</option>
            {['Available', 'On Duty', 'Off Duty'].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select value={skill} onChange={(e) => setSkill(e.target.value)} aria-label="Filter volunteer skill">
            <option>All skills</option>
            {skills.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>

        {filtered.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Volunteer</th>
                  <th>Skills</th>
                  <th>Contact</th>
                  <th>Service area</th>
                  <th>Availability</th>
                  <th>Assigned tasks</th>
                  {isAdmin && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const done = item.tasks.filter((entry) => entry.status === 'Completed').length
                  const pct = item.tasks.length ? Math.round((done / item.tasks.length) * 100) : 0
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="volunteer-cell">
                          <span className="avatar avatar-small">{item.name.split(' ').map((part) => part[0]).join('')}</span>
                          <span>
                            <strong>{item.name}</strong>
                            <small>{item.id}</small>
                          </span>
                        </span>
                      </td>
                      <td>
                        <div className="facility-list">
                          {item.skills.map((entry) => (
                            <span key={entry}>{entry}</span>
                          ))}
                        </div>
                      </td>
                      <td>{item.contact}</td>
                      <td>{item.area}</td>
                      <td><Badge>{item.availability}</Badge></td>
                      <td>
                        <div className="task-progress-label">
                          <span>{item.tasks.length} tasks · {done} done</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="progress-track task-progress">
                          <i style={{ width: `${pct}%` }} />
                        </div>
                        {item.tasks.map((entry) => (
                          <div className="task-mini" key={entry.id}>
                            <span>{entry.title}</span>
                            <Badge>{entry.status}</Badge>
                          </div>
                        ))}
                      </td>
                      {isAdmin && (
                        <td>
                          <button className="button button-small button-secondary" onClick={() => openTask(item)}>
                            Assign Task
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No volunteers found" />
        )}
      </Panel>

      {/* Add Volunteer or Assign Task Modal */}
      {modal && (
        <Modal
          title={modal.mode === 'add' ? 'Register a Volunteer' : `Assign a Task · ${modal.volunteer.name}`}
          onClose={() => setModal(null)}
        >
          <form className="form-stack modal-form" onSubmit={save}>
            {modal.mode === 'add' ? (
              <>
                <Field label="Full name">
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </Field>
                <Field label="Skills (comma-separated)">
                  <input
                    value={form.skills}
                    onChange={(e) => setForm({ ...form, skills: e.target.value })}
                    placeholder="First Aid, Water Rescue, Driving"
                    required
                  />
                </Field>
                <Field label="Contact phone">
                  <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} required />
                </Field>
                <Field label="Service area">
                  <input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} required />
                </Field>
                <Field label="Availability">
                  <select value={form.availability} onChange={(e) => setForm({ ...form, availability: e.target.value })}>
                    {['Available', 'On Duty', 'Off Duty'].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </Field>
              </>
            ) : (
              <>
                <Field label="Task description">
                  <input
                    value={task.title}
                    onChange={(e) => setTask({ ...task, title: e.target.value })}
                    placeholder="e.g. Distribute water packets at Camp 3"
                    required
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Task priority">
                    <select value={task.priority} onChange={(e) => setTask({ ...task, priority: e.target.value })}>
                      <option>Critical</option>
                      <option>High</option>
                      <option>Medium</option>
                      <option>Low</option>
                    </select>
                  </Field>
                  <Field label="Linked incident">
                    <select value={task.incidentId} onChange={(e) => setTask({ ...task, incidentId: e.target.value })}>
                      {incidents.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.id} · {item.type} — {item.location}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Step-by-step instructions">
                  <textarea
                    rows={2}
                    value={task.instructions}
                    onChange={(e) => setTask({ ...task, instructions: e.target.value })}
                    placeholder="Provide specific directions, contact persons on-site, and safety cautions..."
                  />
                </Field>
              </>
            )}
            {error && <small className="field-error">{error}</small>}
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button className="button button-primary">{modal.mode === 'add' ? 'Register' : 'Assign Task'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

// ============================================================================
// ALERTS & OFFICIAL BROADCAST NOTIFICATIONS PAGE
// ============================================================================
function AlertsPage() {
  const { alerts, markRead, markAllRead, createBroadcastAlert, user } = useApp()
  const [filter, setFilter] = useState('All notifications')
  const [showBroadcastModal, setShowBroadcastModal] = useState(false)
  const [broadcastForm, setBroadcastForm] = useState({
    title: '',
    message: '',
    severity: 'High',
    targetArea: 'All Regions',
    type: 'Incident',
  })

  const isAdmin = user.role === 'Authority Administrator'
  const filtered = alerts.filter((item) => {
    const unread = !isAlertReadByUser(item, user)
    return filter === 'All notifications' || (filter === 'Unread' ? unread : item.severity === filter)
  })
  const sorted = [...filtered].sort((a, b) => new Date(b.at) - new Date(a.at))
  const unread = alerts.filter((item) => !isAlertReadByUser(item, user)).length

  const handleBroadcastSubmit = (e) => {
    e.preventDefault()
    if (!broadcastForm.title.trim() || !broadcastForm.message.trim()) return
    createBroadcastAlert(broadcastForm)
    setShowBroadcastModal(false)
    setBroadcastForm({ title: '', message: '', severity: 'High', targetArea: 'All Regions', type: 'Incident' })
  }

  return (
    <>
      <PageTitle
        eyebrow="EMERGENCY BROADCAST NETWORK"
        title="Alerts & Notifications"
        description="Official alerts generated from incidents, shelter telemetry, supply movements, and broadcast bulletins."
        action={
          <div className="action-row">
            {unread > 0 && (
              <button className="button button-secondary" onClick={markAllRead}>
                <CheckCheck size={15} /> Mark All as Read
              </button>
            )}
            {isAdmin && (
              <button className="button button-primary" onClick={() => setShowBroadcastModal(true)}>
                <Radio size={15} /> Broadcast Official Alert
              </button>
            )}
          </div>
        }
      />

      <div className="alert-center-summary">
        <div>
          <span className="alert-summary-icon">
            <Bell size={18} />
          </span>
          <span>
            <strong>{unread} unread notifications</strong>
            <small>Live event feed shared across all 4 operational command roles.</small>
          </span>
        </div>
        <span className="alert-live-indicator">
          <span className="status-dot" /> LIVE EVENT STREAM
        </span>
      </div>

      <div className="alert-filter-row">
        {['All notifications', 'Unread', 'Critical', 'High', 'Medium', 'Low'].map((item) => (
          <button
            key={item}
            className={filter === item ? 'alert-filter active' : 'alert-filter'}
            onClick={() => setFilter(item)}
          >
            {item}
            {item === 'Unread' && unread > 0 && <span>{unread}</span>}
          </button>
        ))}
      </div>

      <Panel title="Notification Feed" subtitle={`${sorted.length} events logged in timeline`}>
        <div className="notification-list">
          {sorted.map((item) => (
            <article className={cx('notification-item', !isAlertReadByUser(item, user) && 'notification-unread')} key={item.id}>
              <div className={`notification-icon notification-${item.severity.toLowerCase()}`}>
                {item.type === 'Shelter' ? (
                  <Home size={18} />
                ) : item.type === 'Resource' ? (
                  <Boxes size={18} />
                ) : item.type === 'Volunteer' ? (
                  <Users size={18} />
                ) : (
                  <Siren size={18} />
                )}
              </div>
              <div className="notification-copy">
                <div className="notification-title-line">
                  <h3>{item.title}</h3>
                  {!isAlertReadByUser(item, user) && <span className="unread-dot" />}
                </div>
                <p>{item.message}</p>
                <div className="notification-meta">
                  <Badge>{item.severity}</Badge>
                  <span>{item.type}</span>
                  {item.targetArea && <span className="target-area-tag"><MapPin size={12} /> {item.targetArea}</span>}
                  <span>
                    <Clock3 size={13} />
                    {timeAgo(item.at)}
                  </span>
                </div>
              </div>
              {!isAlertReadByUser(item, user) && (
                <button className="button button-small button-secondary mark-read" onClick={() => markRead(item.id)}>
                  <Check size={14} /> Mark read
                </button>
              )}
            </article>
          ))}
        </div>
        {!sorted.length && <EmptyState title="You're all caught up" message="No alerts match this filter." />}
      </Panel>

      {/* Broadcast Alert Modal */}
      {showBroadcastModal && (
        <Modal title="Broadcast Official Emergency Alert" onClose={() => setShowBroadcastModal(false)}>
          <form className="form-stack modal-form" onSubmit={handleBroadcastSubmit}>
            <p className="modal-description-copy">
              Publish an authoritative bulletin to all citizens, responders, and shelters with geographic target filtering.
            </p>
            <Field label="Alert Title">
              <input
                required
                value={broadcastForm.title}
                onChange={(e) => setBroadcastForm({ ...broadcastForm, title: e.target.value })}
                placeholder="e.g. Flash Flood Evacuation Notice — Assi Ghat"
              />
            </Field>
            <div className="form-grid">
              <Field label="Severity Level">
                <select
                  value={broadcastForm.severity}
                  onChange={(e) => setBroadcastForm({ ...broadcastForm, severity: e.target.value })}
                >
                  <option>Critical</option>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </Field>
              <Field label="Target Geographic Region">
                <select
                  value={broadcastForm.targetArea}
                  onChange={(e) => setBroadcastForm({ ...broadcastForm, targetArea: e.target.value })}
                >
                  <option>All Regions</option>
                  <option>Varanasi</option>
                  <option>Pune</option>
                  <option>Chennai</option>
                  <option>Ahmedabad</option>
                  <option>Dehradun</option>
                  <option>Kolkata</option>
                  <option>Hyderabad</option>
                </select>
              </Field>
            </div>
            <Field label="Detailed Instructions / Bulletin Copy">
              <textarea
                required
                rows={3}
                value={broadcastForm.message}
                onChange={(e) => setBroadcastForm({ ...broadcastForm, message: e.target.value })}
                placeholder="Specify affected wards, evacuation paths, designated relief centres, and safety steps..."
              />
            </Field>
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setShowBroadcastModal(false)}>
                Cancel
              </button>
              <button type="submit" className="button button-danger">
                <Radio size={16} /> Broadcast Network Alert
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

// ============================================================================
// ANALYTICS & AUDIT LOGS PAGE (WITH COMPREHENSIVE CSV EXPORT)
// ============================================================================
function AnalyticsPage() {
  const { incidents, shelters, resources, volunteers, activity } = useApp()
  const [type, setType] = useState('All types')
  const [range, setRange] = useState('All time')

  const filtered = incidents.filter(
    (item) =>
      (type === 'All types' || item.type === type) &&
      (range === 'All time' || Date.now() - new Date(item.reportedAt).getTime() <= (range === '7 days' ? 7 : 30) * 86400000)
  )

  const typeData = typeOptions.map((name) => ({
    name,
    count: filtered.filter((item) => item.type === name).length,
  }))

  const severityData = ['Critical', 'High', 'Medium', 'Low'].map((name) => ({
    name,
    value: filtered.filter((item) => item.severity === name).length,
  }))

  const trend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - 6 + index)
    return {
      day: date.toLocaleDateString('en', { weekday: 'short' }),
      reports: filtered.filter((item) => new Date(item.reportedAt).toDateString() === date.toDateString()).length,
    }
  })

  const totalTasks = volunteers.flatMap((item) => item.tasks)
  const completed = totalTasks.filter((item) => item.status === 'Completed').length

  const handleExportAuditLogs = () => {
    const columns = [
      { label: 'Event ID', key: 'id' },
      { label: 'Timestamp', key: 'at' },
      { label: 'Description', key: 'text' },
      { label: 'Actor Name', key: 'user' },
      { label: 'Actor Role', key: 'role' },
    ]
    exportToCSV('resqcloud-audit-log', activity, columns)
  }

  const handleExportAnalyticsReport = () => {
    const reportSummary = [
      {
        Metric: 'Total Incidents',
        Value: filtered.length,
      },
      {
        Metric: 'Resolved Incidents',
        Value: filtered.filter((i) => i.status === 'Resolved').length,
      },
      {
        Metric: 'Active Operational Shelters',
        Value: shelters.filter((s) => s.status === 'Operational').length,
      },
      {
        Metric: 'Total Shelter Capacity',
        Value: shelters.reduce((acc, s) => acc + s.capacity, 0),
      },
      {
        Metric: 'Total Occupancy',
        Value: shelters.reduce((acc, s) => acc + s.occupancy, 0),
      },
      {
        Metric: 'Registered Volunteers',
        Value: volunteers.length,
      },
      {
        Metric: 'Completed Volunteer Tasks',
        Value: completed,
      },
    ]
    const columns = [
      { label: 'Metric', key: 'Metric' },
      { label: 'Value', key: 'Value' },
    ]
    exportToCSV('resqcloud-operational-analytics', reportSummary, columns)
  }

  return (
    <>
      <PageTitle
        eyebrow="RESPONSE INTELLIGENCE & AUDIT"
        title="Analytics & Operational Audit"
        description="Live data telemetry across emergency incident metrics, shelter occupancy curves, and immutable system audit logs."
        action={
          <div className="action-row">
            <button className="button button-secondary" onClick={handleExportAuditLogs}>
              <Download size={14} /> Export Audit Log
            </button>
            <button className="button button-primary" onClick={handleExportAnalyticsReport}>
              <Download size={14} /> Export Analytics
            </button>
          </div>
        }
      />

      <div className="analytics-filters-bar">
        <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Filter analytics date range">
          {['All time', '7 days', '30 days'].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter analytics disaster type">
          <option>All types</option>
          {typeOptions.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>

      <div className="analytics-kpis">
        <div>
          <span>Total reports</span>
          <strong>{filtered.length}</strong>
          <small>{range.toLowerCase()} · selected disaster type</small>
        </div>
        <div>
          <span>Resolution rate</span>
          <strong>{filtered.length ? Math.round((filtered.filter((item) => item.status === 'Resolved').length / filtered.length) * 100) : 0}%</strong>
          <small>{filtered.filter((item) => item.status === 'Resolved').length} resolved reports</small>
        </div>
        <div>
          <span>Avg. affected / incident</span>
          <strong>{filtered.length ? Math.round(filtered.reduce((sum, item) => sum + item.affected, 0) / filtered.length) : 0}</strong>
          <small>people per incident</small>
        </div>
        <div>
          <span>Volunteer task completion</span>
          <strong>{totalTasks.length ? Math.round((completed / totalTasks.length) * 100) : 0}%</strong>
          <small>{completed} of {totalTasks.length} tasks completed</small>
        </div>
      </div>

      <div className="analytics-grid">
        <Panel title="Reports by disaster type" subtitle="Incident count by disaster category">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={typeData} margin={{ top: 12, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#edf0f5" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#8691a5', fontSize: 11 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8691a5', fontSize: 11 }} />
                <Tooltip contentStyle={chartTooltip} />
                <Bar dataKey="count" fill="#2563eb" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Incident severity share" subtitle="Share of reports by severity level">
          <div className="analytics-donut">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={severityData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={88} paddingAngle={3} stroke="none">
                  {severityData.map((entry) => (
                    <Cell key={entry.name} fill={severityColors[entry.name]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={chartTooltip} />
                <Legend verticalAlign="bottom" height={30} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Daily incident report rate" subtitle="Report frequency over the past 7 days">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 12, right: 12, left: -22, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#edf0f5" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#8691a5', fontSize: 11 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8691a5', fontSize: 11 }} />
                <Tooltip contentStyle={chartTooltip} />
                <Line type="monotone" dataKey="reports" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3, fill: '#2563eb' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Shelter bed utilization" subtitle="Live bed occupancy across registered shelters">
          <div className="analytics-shelters">
            {shelters.map((item) => {
              const pct = item.capacity ? Math.round((item.occupancy / item.capacity) * 100) : 0
              return (
                <div key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.occupancy} / {item.capacity} · {pct}%</span>
                  </div>
                  <div className="progress-track">
                    <i className={pct > 85 ? 'progress-warn' : ''} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        <Panel title="Resource inventory on hand" subtitle="Aggregated supply stock levels">
          <div className="analytics-resources">
            {['Food packets', 'Drinking water', 'Medicines', 'Blankets', 'First-aid kits', 'Rescue equipment'].map((item) => {
              const count = resources
                .filter((resource) => resource.item === item)
                .reduce((sum, resource) => sum + resource.quantity, 0)
              return (
                <div key={item}>
                  <span>{item}</span>
                  <strong className={count <= 50 ? 'quantity-low' : ''}>{formatNumber(count)} <small>units</small></strong>
                </div>
              )
            })}
          </div>
        </Panel>

        <Panel title="Lifecycle resolution breakdown" subtitle="Reports categorized by operational status">
          <div className="resolution-list">
            {statusOptions.map((item) => {
              const count = incidents.filter((incident) => incident.status === item).length
              const pct = incidents.length ? Math.round((count / incidents.length) * 100) : 0
              return (
                <div key={item}>
                  <div>
                    <Badge>{item}</Badge>
                    <strong>{count}</strong>
                  </div>
                  <div className="progress-track">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
      </div>

      {/* Official System Audit Log Table */}
      <Panel
        title="Official System Audit Log"
        subtitle="Chronological transaction and decision ledger across all response roles"
        action={
          <button className="button button-small button-secondary" onClick={handleExportAuditLogs}>
            <Download size={14} /> Export Audit Log
          </button>
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Event ID</th>
                <th>Action & Description</th>
                <th>Actor</th>
                <th>Role</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((item) => (
                <tr key={item.id}>
                  <td className="table-id">{item.id}</td>
                  <td>
                    <span className="audit-action-cell">
                      <Activity size={14} />
                      {item.text}
                    </span>
                  </td>
                  <td><strong>{item.user || 'System'}</strong></td>
                  <td><Badge>{item.role || 'System'}</Badge></td>
                  <td className="time-cell">{timeAgo(item.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}

// ============================================================================
// SETTINGS & USER MANAGEMENT PAGE
// ============================================================================
function SettingsPage({ onToast }) {
  const { user, users, updateProfile, resetData, incidents, shelters, resources, volunteers } = useApp()
  const [name, setName] = useState(user.name)
  const [phone, setPhone] = useState(user.phone || '')
  const [address, setAddress] = useState(user.address || '')
  const [confirmReset, setConfirmReset] = useState(false)

  const isAdmin = user.role === 'Authority Administrator'

  const save = (e) => {
    e.preventDefault()
    updateProfile({ name, phone, address })
    onToast('Profile updated')
  }

  return (
    <>
      <PageTitle
        eyebrow="PREFERENCES & ACCESS MANAGEMENT"
        title="Settings & Accounts"
        description="Manage your profile credentials, review registered user accounts, and inspect data persistence."
      />

      <div className="settings-grid">
        <Panel title="My Profile Credentials" subtitle="Update your personal contact details">
          <form className="form-stack settings-form" onSubmit={save}>
            <Field label="Display Name">
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Active Role">
              <input value={user.role} disabled className="disabled-input" />
              <small>Role permissions are bound to your account profile.</small>
            </Field>
            <Field label="Contact Phone">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 90000 00000" />
            </Field>
            <Field label="Physical Address / District">
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. Assi Ghat Lane 4, Varanasi" />
            </Field>
            <button className="button button-primary">Save Profile Changes</button>
          </form>
        </Panel>

        <Panel title="Prototype Storage Engine" subtitle="Local storage data persistence">
          <div className="data-count-grid">
            <div><strong>{incidents.length}</strong><span>incidents</span></div>
            <div><strong>{shelters.length}</strong><span>shelters</span></div>
            <div><strong>{resources.length}</strong><span>resources</span></div>
            <div><strong>{volunteers.length}</strong><span>volunteers</span></div>
          </div>
          <p className="settings-note">
            ResQCloud operates with a shared local state cache. Cross-role operations (such as citizen reports,
            rescue tickets, volunteer assignments, and confirmed supply receipts) persist in this browser.
          </p>
          <button className="button button-danger-outline" onClick={() => setConfirmReset(true)}>
            Reset Dataset
          </button>
        </Panel>
      </div>

      {/* Authority Administrator User Management Section */}
      {isAdmin && (
        <Panel title="Registered Users & Roles Directory" subtitle="System user accounts, credentials, and contact records">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Location / District</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.email || u.name}>
                    <td>
                      <span className="volunteer-cell">
                        <span className="avatar avatar-small">{u.name.split(' ').map((p) => p[0]).join('')}</span>
                        <strong>{u.name}</strong>
                      </span>
                    </td>
                    <td><Badge>{u.role}</Badge></td>
                    <td>{u.email}</td>
                    <td>{u.phone || '—'}</td>
                    <td>{u.address || '—'}</td>
                    <td><Badge tone="Resolved">Active</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Access Control Matrix" subtitle="Portal pages and capabilities by role">
        <div className="access-grid">
          {roles.map((item) => (
            <div key={item}>
              <strong>{item}</strong>
              <div className="access-tags">
                {navItems
                  .filter((entry) => entry.roles.includes(item))
                  .map((entry) => (
                    <span key={entry.path}>{entry.label}</span>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {confirmReset && (
        <Modal title="Reset system data to initial state?" onClose={() => setConfirmReset(false)}>
          <p className="confirm-copy">
            This will wipe local modifications and restore the clean initial ResQCloud multi-role dataset.
          </p>
          <div className="modal-actions">
            <button className="button button-secondary" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
            <button
              className="button button-danger"
              onClick={() => {
                resetData()
                setConfirmReset(false)
                onToast('System data reset to initial state')
              }}
            >
              Reset Data
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

// ============================================================================
// NOT FOUND
// ============================================================================
function NotFound() {
  return (
    <div className="not-found">
      <div className="empty-icon">
        <CircleHelp size={22} />
      </div>
      <h2>Page not found</h2>
      <p>This response command route is not recognized.</p>
      <Link className="button button-primary" to="/">
        Return to Dashboard
      </Link>
    </div>
  )
}

// ============================================================================
// MAIN APP ROUTER
// ============================================================================
export default function App() {
  const { user } = useApp()
  const [toast, setToast] = useState('')
  const [globalSearch, setGlobalSearch] = useState('')
  const location = useLocation()

  const onToast = (message) => {
    setToast(message)
    window.clearTimeout(window.__resqToastTimer)
    window.__resqToastTimer = window.setTimeout(() => setToast(''), 3500)
  }

  if (!user && location.pathname !== '/login') return <Navigate to="/login" replace />
  if (user && location.pathname === '/login') return <Navigate to="/" replace />
  if (!user) return <LoginPage />

  const allowedPath = navItems.find((item) => item.path === location.pathname)
  if (allowedPath && !allowedPath.roles.includes(user.role)) {
    return (
      <AppLayout onSearch={setGlobalSearch}>
        <div className="access-denied">
          <span className="access-denied-icon">
            <Shield size={22} />
          </span>
          <h1>Restricted Portal Workspace</h1>
          <p>
            Your current account role (<strong>{user.role}</strong>) does not have access permissions for {allowedPath.label}.
          </p>
          <Link className="button button-primary" to="/">
            Return to My Dashboard <ArrowRight size={15} />
          </Link>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout onSearch={setGlobalSearch}>
      <Routes>
        <Route path="/" element={<Dashboard onToast={onToast} onSearch={setGlobalSearch} globalSearch={globalSearch} />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        <Route path="/incidents" element={<IncidentsPage onToast={onToast} globalSearch={globalSearch} />} />
        <Route path="/report" element={<ReportPage onToast={onToast} />} />
        <Route path="/map" element={<MapPage globalSearch={globalSearch} />} />
        <Route path="/shelters" element={<SheltersPage onToast={onToast} />} />
        <Route path="/resources" element={<ResourcesPage onToast={onToast} />} />
        <Route path="/volunteers" element={<VolunteersPage onToast={onToast} />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/settings" element={<SettingsPage onToast={onToast} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toast message={toast} onClose={() => setToast('')} />
    </AppLayout>
  )
}
