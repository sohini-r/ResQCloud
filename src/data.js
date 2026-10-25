const ago = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

export const roles = ['Citizen', 'Authority Administrator', 'Volunteer', 'Shelter Manager']

export const initialIncidents = [
  { id: 'INC-2408', type: 'Flood', description: 'Rising water along the riverside road; residents need assistance reaching higher ground.', location: 'Assi Ghat, Varanasi', lat: 25.2895, lng: 83.0068, affected: 128, severity: 'Critical', status: 'Response Dispatched', reportedAt: ago(0.5), reporter: 'Aarav Mehta', team: 'River Rescue Unit' },
  { id: 'INC-2407', type: 'Fire', description: 'Warehouse fire reported near the industrial access road. Smoke is visible from nearby blocks.', location: 'Industrial Estate, Pune', lat: 18.6298, lng: 73.7997, affected: 46, severity: 'High', status: 'Verified', reportedAt: ago(2), reporter: 'Nisha Rao' },
  { id: 'INC-2406', type: 'Cyclone', description: 'Roof damage and fallen branches following strong coastal winds.', location: 'Marina Beach, Chennai', lat: 13.0500, lng: 80.2824, affected: 72, severity: 'High', status: 'Under Verification', reportedAt: ago(5), reporter: 'Kiran Das' },
  { id: 'INC-2405', type: 'Earthquake', description: 'Residents reported tremors; structural inspection requested for older buildings.', location: 'Lal Darwaza, Ahmedabad', lat: 23.0225, lng: 72.5714, affected: 215, severity: 'Medium', status: 'Verified', reportedAt: ago(9), reporter: 'Diya Shah' },
  { id: 'INC-2404', type: 'Landslide', description: 'Debris partially blocks the hillside road. No injuries reported so far.', location: 'Mussoorie Road, Dehradun', lat: 30.4598, lng: 78.0644, affected: 18, severity: 'Medium', status: 'Reported', reportedAt: ago(14), reporter: 'Rohan Negi' },
  { id: 'INC-2403', type: 'Flood', description: 'Waterlogging in the low-lying market lane after heavy rainfall.', location: 'Rajwada, Indore', lat: 22.7196, lng: 75.8577, affected: 33, severity: 'Low', status: 'Resolved', reportedAt: ago(27), reporter: 'Maya Joshi', reporterId: 'USR-CITIZEN-1' },
  { id: 'INC-2402', type: 'Fire', description: 'Small kitchen fire contained by the community response team.', location: 'Banjara Hills, Hyderabad', lat: 17.4126, lng: 78.4482, affected: 12, severity: 'Low', status: 'Resolved', reportedAt: ago(38), reporter: 'Imran Ali' },
  { id: 'INC-2401', type: 'Other', description: 'Temporary power outage affecting a community gathering point.', location: 'Salt Lake, Kolkata', lat: 22.5726, lng: 88.3639, affected: 60, severity: 'Low', status: 'Resolved', reportedAt: ago(52), reporter: 'Sneha Roy' },
]

export const initialShelters = [
  { id: 'SH-01', name: 'Riverside Community Hall', manager: 'Priya Nair', managerId: 'USR-SHELTER-1', address: '12 Lanka Road, Varanasi', location: 'Varanasi', capacity: 320, occupancy: 246, facilities: ['Medical aid', 'Meals', 'Accessible'], status: 'Operational' },
  { id: 'SH-02', name: 'Sahyadri Relief Centre', manager: 'Dev Kumar', managerId: 'USR-SHELTER-2', address: '5 Pimpri Link Road, Pune', location: 'Pune', capacity: 240, occupancy: 218, facilities: ['Meals', 'Family rooms'], status: 'Operational' },
  { id: 'SH-03', name: 'Marina School Relief Hub', manager: 'Lee Joseph', managerId: 'USR-SHELTER-3', address: '30 Beach Road, Chennai', location: 'Chennai', capacity: 400, occupancy: 186, facilities: ['Medical aid', 'Meals', 'Accessible'], status: 'Operational' },
  { id: 'SH-04', name: 'Central Sports Pavilion', manager: 'Nina Shah', managerId: 'USR-SHELTER-4', address: '4 Ashram Road, Ahmedabad', location: 'Ahmedabad', capacity: 180, occupancy: 0, facilities: ['Accessible'], status: 'Standby' },
  { id: 'SH-05', name: 'Hillview Primary School', manager: 'Rohan Negi', managerId: 'USR-SHELTER-5', address: '8 Library Road, Dehradun', location: 'Dehradun', capacity: 150, occupancy: 0, facilities: ['Meals', 'Family rooms'], status: 'Maintenance' },
]

export const initialResources = [
  { id: 'RES-101', item: 'Food packets', quantity: 860, shelter: 'Riverside Community Hall', updatedAt: ago(1) },
  { id: 'RES-102', item: 'Drinking water', quantity: 46, shelter: 'Sahyadri Relief Centre', updatedAt: ago(2) },
  { id: 'RES-103', item: 'Medicines', quantity: 174, shelter: 'Marina School Relief Hub', updatedAt: ago(4) },
  { id: 'RES-104', item: 'Blankets', quantity: 28, shelter: 'Riverside Community Hall', updatedAt: ago(7) },
  { id: 'RES-105', item: 'First-aid kits', quantity: 91, shelter: 'Sahyadri Relief Centre', updatedAt: ago(12) },
  { id: 'RES-106', item: 'Rescue equipment', quantity: 14, shelter: 'Central Sports Pavilion', updatedAt: ago(20) },
  { id: 'RES-107', item: 'Food packets', quantity: 530, shelter: 'Marina School Relief Hub', updatedAt: ago(26) },
]

export const initialVolunteers = [
  { id: 'VOL-201', userId: 'USR-VOL-1', name: 'Ananya Kapoor', skills: ['First Aid', 'Medical'], contact: '+91 90000 12001', area: 'Varanasi', availability: 'On Duty', tasks: [{ id: 'TSK-31', title: 'Triage support', incidentId: 'INC-2408', status: 'In Progress' }] },
  { id: 'VOL-202', userId: 'USR-VOL-2', name: 'Kabir Menon', skills: ['Water Rescue', 'Driving'], contact: '+91 90000 12002', area: 'Varanasi', availability: 'On Duty', tasks: [{ id: 'TSK-32', title: 'Boat evacuation support', incidentId: 'INC-2408', status: 'Assigned' }] },
  { id: 'VOL-203', userId: 'USR-VOL-3', name: 'Meera Iyer', skills: ['Logistics', 'First Aid'], contact: '+91 90000 12003', area: 'Chennai', availability: 'Available', tasks: [{ id: 'TSK-33', title: 'Shelter supply check', incidentId: 'INC-2406', status: 'Completed' }] },
  { id: 'VOL-204', userId: 'USR-VOL-4', name: 'Arjun Bose', skills: ['Search & Rescue'], contact: '+91 90000 12004', area: 'Pune', availability: 'Available', tasks: [] },
  { id: 'VOL-205', userId: 'USR-VOL-5', name: 'Tara Sen', skills: ['Translation', 'Community Support'], contact: '+91 90000 12005', area: 'Ahmedabad', availability: 'Off Duty', tasks: [{ id: 'TSK-34', title: 'Resident check-in', incidentId: 'INC-2405', status: 'Pending' }] },
]

export const initialAlerts = [
  { id: 'ALT-01', title: 'Critical flood report — Assi Ghat', message: '128 people affected. River Rescue Unit has been dispatched.', severity: 'Critical', at: ago(0.5), read: false, readBy: [], type: 'Incident' },
  { id: 'ALT-02', title: 'Shelter nearing capacity', message: 'Sahyadri Relief Centre has only 22 beds available.', severity: 'High', at: ago(2), read: false, readBy: [], type: 'Shelter' },
  { id: 'ALT-03', title: 'Low stock: drinking water', message: '46 units remain at Sahyadri Relief Centre.', severity: 'Medium', at: ago(4), read: false, readBy: [], type: 'Resource' },
  { id: 'ALT-04', title: 'Incident verified', message: 'Fire report INC-2407 was verified by the authority team.', severity: 'Low', at: ago(6), read: true, readBy: ['USR-ADMIN-1'], type: 'Incident' },
  { id: 'ALT-05', title: 'Volunteer task completed', message: 'Shelter supply check at Marina School Relief Hub is complete.', severity: 'Low', at: ago(12), read: true, readBy: ['USR-ADMIN-1'], type: 'Volunteer' },
]

export const initialTransactions = [
  { id: 'TX-1004', item: 'Food packets', change: -120, shelter: 'Riverside Community Hall', note: 'Relief dispatch', at: ago(1) },
  { id: 'TX-1003', item: 'Drinking water', change: -80, shelter: 'Sahyadri Relief Centre', note: 'Incident allocation', at: ago(2) },
  { id: 'TX-1002', item: 'Medicines', change: 60, shelter: 'Marina School Relief Hub', note: 'Stock received', at: ago(4) },
]

export const initialResourceRequests = [
  { id: 'REQ-301', item: 'Drinking water', quantity: 120, shelter: 'Sahyadri Relief Centre', priority: 'High', status: 'Pending', at: ago(1), requestedBy: 'Dev Kumar' },
  { id: 'REQ-302', item: 'Blankets', quantity: 45, shelter: 'Riverside Community Hall', priority: 'Medium', status: 'Dispatched', at: ago(3), dispatchedAt: ago(1), requestedBy: 'Priya Nair' },
  { id: 'REQ-303', item: 'First-aid kits', quantity: 20, shelter: 'Marina School Relief Hub', priority: 'Low', status: 'Received', at: ago(12), receivedAt: ago(6), requestedBy: 'Lee Joseph' },
]

export const initialRescueRequests = [
  { id: 'RSC-101', citizenName: 'Maya Joshi', citizenId: 'USR-CITIZEN-1', contact: '+91 98200 44321', location: 'Assi Ghat Lane 4, Varanasi', peopleCount: 4, medicalEmergency: true, description: 'Water entered ground floor, elderly grandparent needs evacuation assistance.', priority: 'Critical', status: 'In Progress', assignedTeam: 'River Rescue Unit', reportedAt: ago(1.5) },
  { id: 'RSC-102', citizenName: 'Aarav Mehta', citizenId: 'USR-AARAV', contact: '+91 98200 11223', location: 'Near Temple Steps, Assi Ghat', peopleCount: 2, medicalEmergency: false, description: 'Stranded on rooftop due to flash flooding.', priority: 'High', status: 'Assigned', assignedTeam: 'Urban Search & Rescue', reportedAt: ago(3) },
  { id: 'RSC-103', citizenName: 'Kavita Sen', citizenId: 'USR-KAVITA', contact: '+91 98200 99887', location: 'Market Street, Rajwada, Indore', peopleCount: 5, medicalEmergency: false, description: 'Basement flooded, road blocked by fallen branches.', priority: 'Medium', status: 'Pending', assignedTeam: null, reportedAt: ago(5) },
]

export const initialCitizenReliefRequests = [
  { id: 'REL-501', citizenName: 'Maya Joshi', citizenId: 'USR-CITIZEN-1', contact: '+91 98200 44321', location: 'Assi Ghat Community Camp', item: 'Drinking water', quantity: 10, urgency: 'High', status: 'Dispatched', notes: 'Urgent for infants and seniors', requestedAt: ago(2) },
  { id: 'REL-502', citizenName: 'Maya Joshi', citizenId: 'USR-CITIZEN-1', contact: '+91 98200 44321', location: 'Assi Ghat Community Camp', item: 'Blankets', quantity: 6, urgency: 'Medium', status: 'Requested', notes: 'Night temperatures dropping', requestedAt: ago(4) },
  { id: 'REL-503', citizenName: 'Rohan Negi', citizenId: 'USR-ROHAN', contact: '+91 98200 55443', location: 'Hillside Cluster B, Dehradun', item: 'Medicines', quantity: 2, urgency: 'High', status: 'Approved', notes: 'First-aid antiseptics and bandages', requestedAt: ago(7) },
]

export const initialOccupants = [
  { id: 'OCC-1001', shelterId: 'SH-01', shelterName: 'Riverside Community Hall', name: 'Rajesh Sharma', familyMembersCount: 4, contact: '+91 98111 22334', medicalNeeds: 'Asthma patient in family', checkInAt: ago(24), status: 'Checked In' },
  { id: 'OCC-1002', shelterId: 'SH-01', shelterName: 'Riverside Community Hall', name: 'Sunita Verma', familyMembersCount: 3, contact: '+91 98111 33445', medicalNeeds: 'None', checkInAt: ago(18), status: 'Checked In' },
  { id: 'OCC-1003', shelterId: 'SH-02', shelterName: 'Sahyadri Relief Centre', name: 'Ganesh Shinde', familyMembersCount: 5, contact: '+91 98111 44556', medicalNeeds: 'Diabetic', checkInAt: ago(12), status: 'Checked In' },
  { id: 'OCC-1004', shelterId: 'SH-01', shelterName: 'Riverside Community Hall', name: 'Amitabh Sen', familyMembersCount: 2, contact: '+91 98111 55667', medicalNeeds: 'None', checkInAt: ago(48), checkOutAt: ago(6), status: 'Checked Out' },
]

export const initialShelterIssues = [
  { id: 'ISS-201', shelterId: 'SH-01', shelterName: 'Riverside Community Hall', issueType: 'Power Outage', description: 'Backup generator fuel running low; requires refueling within 6 hours.', severity: 'High', status: 'Reported', reportedBy: 'Priya Nair', reportedAt: ago(3) },
  { id: 'ISS-202', shelterId: 'SH-02', shelterName: 'Sahyadri Relief Centre', issueType: 'Water Shortage', description: 'Overhead tank municipal supply disrupted; water tanker requested.', severity: 'Critical', status: 'Under Review', reportedBy: 'Dev Kumar', reportedAt: ago(5) },
]

export const initialAvailableVolunteerTasks = [
  { id: 'TSK-51', title: 'Distribute 80 food packets to Camp 3', incidentId: 'INC-2408', area: 'Varanasi', priority: 'High', instructions: 'Pick up ration kits from Riverside Community Hall store room and deliver to Assi Ghat relief cluster.', status: 'Available' },
  { id: 'TSK-52', title: 'Elderly assistance & check-in', incidentId: 'INC-2405', area: 'Ahmedabad', priority: 'Medium', instructions: 'Help senior citizens fill shelter registration forms at Central Sports Pavilion.', status: 'Available' },
  { id: 'TSK-53', title: 'Medical triage queue coordination', incidentId: 'INC-2407', area: 'Pune', priority: 'Critical', instructions: 'Direct injured residents to primary triage ambulance tent near Gate 2.', status: 'Available' },
]

export const initialFieldReports = [
  { id: 'FLD-401', volunteerName: 'Ananya Kapoor', location: 'Assi Ghat Lowland, Varanasi', lat: 25.291, lng: 83.008, observation: 'Floodwater receding by 3 inches, but inner alleys still knee-deep.', severity: 'High', submittedAt: ago(2) },
  { id: 'FLD-402', volunteerName: 'Kabir Menon', location: 'Assi Riverbank Checkpoint', lat: 25.288, lng: 83.004, observation: 'Safe boat docking achieved; 25 residents moved to high ground.', severity: 'Medium', submittedAt: ago(4) },
]

export const initialDeliveryLogs = [
  { id: 'DEL-801', volunteerName: 'Ananya Kapoor', recipient: 'Riverside Community Hall', item: 'Food packets', quantity: 60, deliveredAt: ago(3) },
  { id: 'DEL-802', volunteerName: 'Meera Iyer', recipient: 'Marina School Relief Hub', item: 'Blankets', quantity: 25, deliveredAt: ago(8) },
]

export const emergencyHelplines = [
  { name: 'National Disaster Response Force (NDRF)', number: '1078', desc: 'Disaster search and rescue 24/7' },
  { name: 'National Emergency Response System', number: '112', desc: 'Police, Fire, and Medical unified emergency' },
  { name: 'Ambulance & Medical Emergency', number: '108', desc: 'State medical dispatch and trauma care' },
  { name: 'Fire Emergency Service', number: '101', desc: 'Fire outbreak and hazmat response' },
  { name: 'Disaster Management Control Room', number: '1070', desc: 'State relief commissioner control room' },
  { name: 'Women & Child Safety Helpline', number: '1091', desc: 'Protection and immediate assistance' },
]

export const initialUsers = [
  { id: 'USR-ADMIN-1', name: 'Alex Morgan', role: 'Authority Administrator', email: 'alex.morgan@resqcloud.gov.in', password: 'password123', phone: '+91 98000 00001', address: 'Disaster Ops Command, New Delhi' },
  { id: 'USR-CITIZEN-1', name: 'Maya Joshi', role: 'Citizen', email: 'maya.joshi@example.com', password: 'password123', phone: '+91 98200 44321', address: 'Assi Ghat Lane 4, Varanasi' },
  { id: 'USR-VOL-1', name: 'Ananya Kapoor', role: 'Volunteer', email: 'ananya.k@resqvolunteers.org', password: 'password123', phone: '+91 90000 12001', address: 'Varanasi Central' },
  { id: 'USR-SHELTER-1', name: 'Priya Nair', role: 'Shelter Manager', email: 'priya.nair@resqshelters.org', password: 'password123', phone: '+91 90000 33001', address: '12 Lanka Road, Varanasi' },
]

export const initialActivity = [
  { id: 'ACT-1', text: 'River Rescue Unit dispatched to INC-2408', at: ago(0.5), icon: 'truck', user: 'Alex Morgan', role: 'Authority Administrator' },
  { id: 'ACT-2', text: 'Fire report INC-2407 verified by Nisha Rao', at: ago(2), icon: 'check', user: 'Nisha Rao', role: 'Authority Administrator' },
  { id: 'ACT-3', text: 'Drinking water stock allocated to Sahyadri Relief Centre', at: ago(3), icon: 'box', user: 'System', role: 'Authority Administrator' },
  { id: 'ACT-4', text: 'Volunteer team checked in at Marina School Relief Hub', at: ago(8), icon: 'users', user: 'Meera Iyer', role: 'Volunteer' },
]

