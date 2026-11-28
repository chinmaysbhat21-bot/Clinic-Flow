const $ = id => document.getElementById(id);
const apiOrigin = 'http://127.0.0.1:4000';
const currency = new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR'});
let session = null;
let expiryTimer;
let editedService = null;
let editedDoctor = null;
let timezone = 'Asia/Kolkata';
let doctors = new Map(), services = new Map();
let appointmentRequest = 0, queueRequest = 0, detailRequest = 0;

const label = value => String(value ?? '—').replaceAll('_', ' ').toLowerCase().replace(/^./, character => character.toUpperCase());
const money = paise => paise == null ? '—' : currency.format(paise / 100);
const dateTime = value => value ? new Intl.DateTimeFormat('en-IN', {dateStyle:'medium', timeStyle:'short', timeZone:timezone}).format(new Date(value)) : '—';

function element(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}

async function request(path, {method='GET', body, current=session} = {}) {
  const headers = {Accept:'application/json'};
  if (current) headers.Authorization = 'Bearer ' + current.token;
  if (body) headers['Content-Type'] = 'application/json';
  if (current && (current !== session || current.expiresAt <= Date.now())) {
    if (current === session) signOut('Your session expired. Sign in again.');
    throw new Error('Sign in again to continue.');
  }
  const response = await fetch(apiOrigin + '/api/admin/' + path, {
    method, headers, credentials:'omit', body:body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => null);
  if (response.status === 401 && current && current === session) signOut('Your session expired. Sign in again.');
  if (!response.ok || !result?.ok) throw new Error(result?.error?.message || 'The clinic API could not complete the request.');
  return result.data;
}

function signOut(message) {
  clearTimeout(expiryTimer);
  session = null;
  editedService = null;
  editedDoctor = null;
  $('edit-doctor').hidden = true;
  doctors.clear();
  services.clear();
  if ($('detail').open) $('detail').close();
  for (const id of ['metrics','appointments','operations','detail-content','doctor-list','doctor-services','service-list']) $(id).replaceChildren();
  for (const id of ['clinic','session-expiry','appointment-status','operations-status','doctor-status','doctor-edit-status','service-status','clinic-status']) $(id).textContent = '';
  $('filters').reset();
  $('add-doctor').reset();
  $('service-form').reset();
  $('edit-doctor').reset();
  $('clinic-form').reset();
  $('account').hidden = $('dashboard').hidden = true;
  $('login-panel').hidden = false;
  $('status').textContent = message;
  $('login').elements.email.focus();
}

function addRow(table, columns) {
  const row = element('tr');
  for (const value of columns) {
    const cell = element('td');
    if (value instanceof Node) cell.append(value);
    else cell.textContent = value ?? '—';
    row.append(cell);
  }
  $(table).append(row);
}

async function loadAppointments(current) {
  const sequence = ++appointmentRequest;
  const active = () => current === session && sequence === appointmentRequest;
  const query = new URLSearchParams();
  for (const [key, value] of new FormData($('filters'))) if (String(value).trim()) query.set(key, String(value).trim());
  $('appointment-status').textContent = 'Loading appointments…';
  try {
    const rows = await request('appointments?' + query, {current});
    if (!active()) return;
    $('appointments').replaceChildren();
    for (const row of rows) {
      const detail = element('button', row.reference);
      detail.type = 'button';
      detail.className = 'link';
      detail.addEventListener('click', () => openAppointment(row.id, current));
      addRow('appointments',[detail,dateTime(row.start),doctors.get(row.doctor_id) ?? row.doctor_id,services.get(row.service_id) ?? row.service_id,label(row.state)]);
    }
    $('appointment-status').textContent = rows.length ? rows.length + ' appointment(s)' : 'No matching appointments.';
  } catch (error) {
    if (active()) {
      $('appointments').replaceChildren();
      $('appointment-status').textContent = error.message;
    }
  }
}

async function loadOperations(current) {
  const sequence = ++queueRequest;
  const active = () => current === session && sequence === queueRequest;
  const queue = $('queue').value;
  $('operations').replaceChildren();
  $('operations-status').textContent = 'Loading operations…';
  try {
    const rows = await request(queue, {current});
    if (!active()) return;
    for (const row of rows) {
      const kind = row.kind ?? row.event ?? 'Refund';
      const detail = queue === 'refunds' ? [money(row.amount), row.reviewReason && label(row.reviewReason)].filter(Boolean).join(' · ')
        : row.reason ? label(row.reason) : row.status === 'ACCEPTED' ? 'Accepted by provider' : row.channel ? label(row.channel) : '—';
      addRow('operations',[label(kind),row.bookingReference,label(row.status),detail]);
    }
    $('operations-status').textContent = rows.length ? rows.length + ' operation(s)' : 'No operations in this queue.';
  } catch (error) {
    if (active()) $('operations-status').textContent = error.message;
  }
}

async function openAppointment(id,current) {
  const sequence = ++detailRequest;
  const active = () => current === session && sequence === detailRequest && $('detail').open;
  $('detail-content').textContent = 'Loading details…';
  $('detail').showModal();
  try {
    const row = await request('appointments/' + encodeURIComponent(id), {current});
    if (!active()) return;
    const details = element('dl');
    for (const [name,value] of [
      ['Reference',row.reference],['Status',label(row.state)],['Starts',dateTime(row.start)],['Ends',dateTime(row.end)],
      ['Doctor',doctors.get(row.doctor_id) ?? row.doctor_id],['Service',services.get(row.service_id) ?? row.service_id],
      ['Booked fee',money(row.fee)],['Duration',row.duration == null ? '—' : row.duration + ' minutes'],
    ]) details.append(element('dt',name),element('dd',value ?? '—'));
    const heading = element('h3','Patient-reported visit summary');
    const briefing = element('p',row.patientBriefing ?? 'No consented visit summary is available for this appointment.');
    briefing.className = 'visit-summary';
    $('detail-content').replaceChildren(details,heading,briefing);
  } catch (error) {
    if (active()) $('detail-content').textContent = error.message;
  }
}

function renderDoctors(doctorRows, serviceRows) {
  $('doctor-list').replaceChildren(...doctorRows.map(doctor => {
    const row = element('li',doctor.name + (doctor.specialization ? ' · ' + doctor.specialization : '') + (doctor.active ? '' : ' (inactive)'));
    const edit = element('button','Edit ' + doctor.name);
    edit.type = 'button';
    edit.className = 'link';
    edit.addEventListener('click',() => {
      editedDoctor = doctor.id;
      const form = $('edit-doctor');
      form.elements.name.value = doctor.name;
      form.elements.specialization.value = doctor.specialization ?? '';
      form.elements.active.checked = !!doctor.active;
      $('doctor-edit-status').textContent = '';
      form.hidden = false;
      form.elements.name.focus();
    });
    row.append(' ',edit);
    return row;
  }));
  const selected = new Set(new FormData($('add-doctor')).getAll('serviceIds'));
  const choices = serviceRows.filter(service => service.active).map(service => {
    const control = document.createElement('input');
    control.type = 'checkbox';
    control.name = 'serviceIds';
    control.value = service.id;
    control.checked = selected.has(service.id);
    const option = element('label');
    option.append(control, document.createTextNode(service.name));
    return option;
  });
  $('doctor-services').replaceChildren(...(choices.length ? choices : [element('p','No active services are available.')]));
  $('add-doctor').querySelector('button').disabled = choices.length === 0;
}

async function refresh(current) {
  $('refresh').disabled = true;
  $('status').textContent = 'Loading clinic overview…';
  try {
    const [config, summary, doctorRows, serviceRows] = await Promise.all(
      ['config','summary','doctors','services'].map(path => request(path,{current})),
    );
    if (current !== session) return;
    timezone = config.config.timezone;
    $('clinic').textContent = config.name;
    doctors = new Map(doctorRows.map(row => [row.id,row.name]));
    services = new Map(serviceRows.map(row => [row.id,row.name]));
    renderDoctors(doctorRows,serviceRows);
    renderServices(serviceRows);
    const fields = $('clinic-form').elements;
    fields.timezone.value = timezone;
    fields.start.value = config.config.operatingHours.start;
    fields.end.value = config.config.operatingHours.end;
    fields.handoff.value = config.config.handoff ?? '';
    $('metrics').replaceChildren();
    for (const [name,value] of [
      ["Today's appointments",summary.today.total],['Upcoming confirmed',summary.upcoming.confirmed],
      ['Verified payments',money(summary.finance.verifiedPayments.amount)],['Pending refunds',money(summary.finance.pendingRefunds.amount)],
      ['Reconciliation review',summary.reconciliation.manual],
    ]) {
      const metric = element('div');
      metric.append(element('dt',name),element('dd',value));
      $('metrics').append(metric);
    }
    $('status').textContent = '';
  } catch (error) {
    if (current === session) $('status').textContent = error.message;
  } finally {
    $('refresh').disabled = false;
  }
  if (current === session) await Promise.all([loadAppointments(current),loadOperations(current)]);
}

$('login').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button');
  submit.disabled = true;
  $('status').textContent = 'Signing in…';
  try {
    const body = Object.fromEntries(new FormData(form));
    const signedIn = await request('login',{method:'POST',body,current:null});
    if (!signedIn?.token || !Number.isFinite(signedIn.expiresIn) || signedIn.expiresIn <= 0) throw new Error('The clinic API did not return a valid session.');
    session = {...signedIn,expiresAt:Date.now()+signedIn.expiresIn*1000};
    const current = session;
    expiryTimer = setTimeout(() => {
      if (session === current) signOut('Your session expired. Sign in again.');
    },signedIn.expiresIn*1000);
    $('session-expiry').textContent = 'Session expires at ' + new Intl.DateTimeFormat(undefined,{timeStyle:'short'}).format(session.expiresAt);
    form.reset();
    $('login-panel').hidden = true;
    $('account').hidden = $('dashboard').hidden = false;
    $('clinic').textContent = session.clinicId;
    $('title').focus();
    await refresh(session);
  } catch (error) {
    $('status').textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
$('logout').addEventListener('click', async () => {
  const current = session;
  if (!current) return;
  $('logout').disabled = true;
  try {
    await request('session',{method:'DELETE',current});
    if (current === session) signOut('Signed out.');
  } catch (error) {
    if (current === session) signOut('Signed out on this device. The server could not confirm revocation.');
  } finally {
    $('logout').disabled = false;
  }
});
$('add-doctor').addEventListener('submit', async event => {
  event.preventDefault();
  const current = session;
  if (!current) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const name = String(data.get('name')).trim();
  const specialization = String(data.get('specialization')).trim();
  const days = data.getAll('days').map(Number);
  const start = Number(data.get('start')), end = Number(data.get('end'));
  const serviceIds = data.getAll('serviceIds');
  const status = $('doctor-status');
  if (!name || !specialization || !days.length || !serviceIds.length || end <= start) {
    status.textContent = 'Enter a name and specialisation, select days and services, and set an end time after the start.';
    return;
  }
  const submit = form.querySelector('button');
  submit.disabled = true;
  status.textContent = 'Adding doctor…';
  try {
    await request('doctors',{method:'POST',current,body:{name,specialization,schedule:{days,start,end},serviceIds}});
    if (current !== session) return;
    form.reset();
    status.textContent = name + ' was added.';
    await refresh(current);
  } catch (error) {
    if (current === session) status.textContent = error.message;
  } finally {
    if (current === session) submit.disabled = !$('doctor-services').querySelector('input');
  }
});
$('refresh').addEventListener('click', () => { if (session) void refresh(session); });
$('filters').addEventListener('submit', event => { event.preventDefault(); if (session) void loadAppointments(session); });
$('queue').addEventListener('change', () => { if (session) void loadOperations(session); });


function renderServices(rows) {
  $('service-list').replaceChildren(...rows.map(row => {
    const item = element('li',row.name + ' · ' + money(row.fee) + ' · ' + row.duration + ' min' + (row.active ? '' : ' (inactive)'));
    const edit = element('button','Edit ' + row.name);
    edit.type = 'button';
    edit.className = 'link';
    edit.addEventListener('click',() => {
      editedService = row.id;
      const form = $('service-form');
      form.elements.name.value = row.name;
      form.elements.fee.value = row.fee / 100;
      form.elements.duration.value = row.duration;
      form.elements.description.value = row.description ?? '';
      form.elements.active.checked = !!row.active;
      $('service-editor').open = true;
      $('service-status').textContent = 'Editing ' + row.name + '.';
      form.elements.name.focus();
    });
    item.append(' ',edit);
    return item;
  }));
}

$('new-service').addEventListener('click',() => {
  editedService = null;
  $('service-form').reset();
  $('service-status').textContent = 'Adding a new service.';
  $('service-form').elements.name.focus();
});

async function saveSettings(form, status, path, method, body, success) {
  const current = session, submit = form.querySelector('[type="submit"]');
  if (!current || submit.disabled) return false;
  submit.disabled = true;
  status.textContent = 'Saving…';
  try {
    const result = await request(path,{method,body,current});
    if (current !== session) return false;
    const warnings = result.warnings ?? [];
    status.textContent = warnings.length ? success + ' Affected appointments: ' + warnings.map(warning => warning.reference ?? warning.bookingReference ?? label(warning.code)).join(', ') + '.' : success;
    await refresh(current);
    return current === session;
  } catch (error) {
    if (current === session) status.textContent = error.message;
    return false;
  } finally {
    submit.disabled = false;
  }
}

$('service-form').addEventListener('submit',async event => {
  event.preventDefault();
  const form = event.currentTarget, data = new FormData(form), id = editedService;
  const name = String(data.get('name')).trim();
  if (!name) { $('service-status').textContent = 'Enter a service name.'; return; }
  const saved = await saveSettings(form,$('service-status'),id ? 'services/'+encodeURIComponent(id) : 'services',id ? 'PATCH' : 'POST',{
    name, duration:Number(data.get('duration')), fee:Math.round(Number(data.get('fee'))*100),
    description:String(data.get('description')).trim(), active:data.has('active'),
  },'Service saved.');
  if (saved && editedService === id) { editedService = null; form.reset(); }
});

$('clinic-form').addEventListener('submit',async event => {
  event.preventDefault();
  const form = event.currentTarget, data = new FormData(form);
  const start = Number(data.get('start')), end = Number(data.get('end'));
  if (end <= start) { $('clinic-status').textContent = 'Closing hour must be after opening hour.'; return; }
  await saveSettings(form,$('clinic-status'),'config','PATCH',{
    timezone:String(data.get('timezone')).trim(),operatingHours:{start,end},handoff:String(data.get('handoff')).trim(),
  },'Clinic settings saved.');
});


$('close-doctor').addEventListener('click',() => { editedDoctor = null; $('edit-doctor').hidden = true; });
$('edit-doctor').addEventListener('submit',async event => {
  event.preventDefault();
  const form = event.currentTarget, data = new FormData(form), id = editedDoctor;
  const name = String(data.get('name')).trim(), specialization = String(data.get('specialization')).trim();
  if (!id || !name || !specialization) { $('doctor-edit-status').textContent = 'Enter a name and specialisation.'; return; }
  await saveSettings(form,$('doctor-edit-status'),'doctors/'+encodeURIComponent(id),'PATCH',{
    name, specialization, active:data.has('active'),
  },'Doctor saved.');
});
