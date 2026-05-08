import {
  observarLogin,
  entrarComGoogle,
  sairDoGoogle,
  garantirWorkspace,
  carregarDadosWorkspace,
  salvarDadosWorkspace,
  criarConvite,
  entrarPorConvite,
  extrairCodigoConvite,
  carregarPerfilUsuario,
  salvarPerfilUsuario,
  carregarMembrosWorkspace,
  carregarGrupoWorkspace,
  sairDoWorkspaceAtual
} from "./firebase.js";

const $ = (id) => document.getElementById(id);
const MONTHS = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const CATEGORIES = ['Cartão','Financiamento','Empréstimo','Assinatura','Casa','Mercado','Veículo','Saúde','Educação','Outros'];
const STORE = 'financi-app-v50';
const PREVIOUS = 'financi-app-v43';
const LEGACY = 'financi-app-v42';
const INSS_2026 = [
  { limit: 1621.00, rate: 0.075 },
  { limit: 2902.84, rate: 0.09 },
  { limit: 4354.27, rate: 0.12 },
  { limit: 8475.55, rate: 0.14 }
];
let state = loadState();
let viewDate = new Date(); viewDate.setDate(1);
let pickerYear = viewDate.getFullYear();
let activeCategory = 'Todas';
let currentUser = null;
let workspaceId = null;
let isCloudReady = false;
let saveTimer = null;
let currentProfile = null;
let workspaceMembers = [];
let currentGroup = null;

function defaultSalary(){return{name:'',gross:0,useINSS:true,showFGTS:true,useTransport:false,useFood:false,foodMode:'value',foodValue:0,useHealth:false,healthMode:'value',healthValue:0}}
function defaultState(){return{version:7,accounts:[],paid:{},salary:{...defaultSalary(),manualExtra:0,useSecondSalary:false,second:{...defaultSalary()}}}}
function normalizeSalary(raw={}){const base={...defaultSalary(),...raw};return{...base,manualExtra:toNumber(raw.manualExtra),useSecondSalary:!!raw.useSecondSalary,second:{...defaultSalary(),...(raw.second||{})}}}
function loadState(){try{const raw=localStorage.getItem(STORE)||localStorage.getItem(PREVIOUS)||localStorage.getItem(LEGACY)||localStorage.getItem('financi-app-v31');const data=raw?JSON.parse(raw):defaultState();return{...defaultState(),...data,paid:data.paid||{},salary:normalizeSalary(data.salary||{})}}catch{return defaultState()}}
function saveState(){
  localStorage.setItem(STORE,JSON.stringify(state));
  if(isCloudReady && workspaceId){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{
      salvarDadosWorkspace(workspaceId,state).catch(err=>console.error('Erro ao salvar no Firebase:',err));
    },450);
  }
}
function setCloudStatus(text){const el=$('shareStatus');if(el)el.textContent=text}
function showLoggedOut(){
  $('authScreen')?.classList.remove('hidden');
  $('appShell')?.classList.add('hidden');
}
function avatarFallback(name,email){
  const base=(name||email||'U').trim();
  return (base[0]||'U').toUpperCase();
}
function profilePhoto(profile,user){return profile?.photoURL||user?.photoURL||''}
function applyProfileTheme(){
  const theme=currentProfile?.theme||'dark';
  document.documentElement.dataset.theme=theme;
  document.body.classList.toggle('compact-mode',!!currentProfile?.compactMode);
}
function renderUserChip(){
  const chip=$('userChip');
  if(!chip)return;
  const name=currentProfile?.name||currentUser?.displayName||currentUser?.email||'Logado';
  const email=currentUser?.email||'';
  const photo=profilePhoto(currentProfile,currentUser);
  chip.innerHTML=`${photo?`<img src="${escapeHtml(photo)}" alt="">`:`<span class="chip-avatar">${escapeHtml(avatarFallback(name,email))}</span>`}<span>${escapeHtml(name)}</span>`;
}
function showLoggedIn(user){
  $('authScreen')?.classList.add('hidden');
  $('appShell')?.classList.remove('hidden');
  renderUserChip();
}
function inviteLinkFromCode(code){return `${location.origin}${location.pathname}?convite=${encodeURIComponent(code)}`}
async function initAuth(){
  $('googleLoginBtn')?.addEventListener('click',async()=>{
    try{$('authStatus').textContent='Abrindo Google...';await entrarComGoogle();}
    catch(err){$('authStatus').textContent='Não foi possível entrar com Google.';console.error(err)}
  });
  observarLogin(async(user)=>{
    if(!user){currentUser=null;currentProfile=null;workspaceMembers=[];currentGroup=null;workspaceId=null;isCloudReady=false;showLoggedOut();return;}
    try{
      currentUser=user;currentProfile=await carregarPerfilUsuario(user.uid);applyProfileTheme();showLoggedIn(user);setCloudStatus('Conectando ao Firebase...');
      workspaceId=await garantirWorkspace(user);
      const urlCode=new URLSearchParams(location.search).get('convite');
      if(urlCode){workspaceId=await entrarPorConvite(urlCode,user);history.replaceState({},'',location.pathname);}
      const remote=await carregarDadosWorkspace(workspaceId);
      if(remote && Array.isArray(remote.accounts)){
        state={...defaultState(),...remote,paid:remote.paid||{},salary:normalizeSalary(remote.salary||{})};
        localStorage.setItem(STORE,JSON.stringify(state));
      }else{
        await salvarDadosWorkspace(workspaceId,state);
      }
      isCloudReady=true;
      currentGroup=await carregarGrupoWorkspace(workspaceId).catch(()=>null);
      workspaceMembers=await carregarMembrosWorkspace(workspaceId).catch(()=>[]);
      renderUserChip();
      setCloudStatus('Sincronização ativa. Compartilhe por convite para usar em casal.');
      render();
    }catch(err){
      console.error(err);
      isCloudReady=false;
      showLoggedIn(user);
      setCloudStatus('Login feito, mas houve erro ao acessar o Firestore. Verifique as regras.');
      render();
    }
  });
}

function toNumber(v){const n=Number(String(v||'').replace(',','.'));return Number.isFinite(n)?n:0}
function money(v){return (v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
function iso(d){return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function parseDate(s){if(!s)return null;const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)}
function sameMonth(a,b){return a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()}
function addMonthsSafe(dateStr,months){const base=parseDate(dateStr)||new Date();const d=new Date(base.getFullYear(),base.getMonth()+months,1);const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(base.getDate(),last));return d}
function monthDiff(from,to){return (to.getFullYear()-from.getFullYear())*12+(to.getMonth()-from.getMonth())}
function escapeHtml(str){return String(str).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function formatDate(d){return d?d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}):''}

function calculateINSS(gross){let prev=0,total=0;for(const band of INSS_2026){const taxable=Math.max(0,Math.min(gross,band.limit)-prev);total+=taxable*band.rate;prev=band.limit;if(gross<=band.limit)break}return Math.min(total,951.62)}
function benefitDeduct(use,mode,value,gross){if(!use)return 0;return mode==='percent'?gross*(value/100):value}
function calcOneSalary(s){const gross=toNumber(s.gross);const inss=s.useINSS?calculateINSS(gross):0;const fgts=s.showFGTS?gross*0.08:0;const transport=s.useTransport?gross*0.06:0;const food=benefitDeduct(s.useFood,s.foodMode,toNumber(s.foodValue),gross);const health=benefitDeduct(s.useHealth,s.healthMode,toNumber(s.healthValue),gross);const totalDeductions=inss+transport+food+health;const net=Math.max(0,gross-totalDeductions);return{name:s.name||'',gross,inss,fgts,transport,food,health,totalDeductions,net}}
function salaryCalc(){const s=state.salary;const first=calcOneSalary(s);const second=s.useSecondSalary?calcOneSalary(s.second||{}):null;const manualExtra=toNumber(s.manualExtra);const gross=first.gross+(second?second.gross:0);const inss=first.inss+(second?second.inss:0);const fgts=first.fgts+(second?second.fgts:0);const transport=first.transport+(second?second.transport:0);const food=first.food+(second?second.food:0);const health=first.health+(second?second.health:0);const totalDeductions=first.totalDeductions+(second?second.totalDeductions:0);const net=first.net+(second?second.net:0)+manualExtra;return{gross,inss,fgts,transport,food,health,totalDeductions,manualExtra,net,first,second}}

function accountTotalPaid(a){if(a.type==='fixed')return a.fixedValue||0;if(a.type==='single')return a.installmentValue||0;const first=a.hasDifferentFirst?(a.firstInstallmentValue||0):(a.installmentValue||0);return first+Math.max(0,(a.installments||1)-1)*(a.installmentValue||0)}
function getPaymentForMonth(a,date){if(a.type==='fixed'){const start=parseDate(a.purchaseDate);if(start&&date>=new Date(start.getFullYear(),start.getMonth(),1))return{value:a.fixedValue||0,label:'Fixa mensal',due:addMonthsSafe(a.purchaseDate,monthDiff(start,date)),status:statusForDue(addMonthsSafe(a.purchaseDate,monthDiff(start,date)))};return null}if(a.type==='single'){const d=parseDate(a.purchaseDate);return sameMonth(d,date)?{value:a.installmentValue||0,label:'Pagamento único',due:d,status:statusForDue(d)}:null}const first=parseDate(a.firstPaymentDate||a.purchaseDate);if(!first)return null;const idx=monthDiff(first,date);if(idx<0||idx>=(a.installments||1))return null;const due=addMonthsSafe(a.firstPaymentDate||a.purchaseDate,idx);const endDate=addMonthsSafe(a.firstPaymentDate||a.purchaseDate,(a.installments||1)-1);const value=idx===0&&a.hasDifferentFirst?(a.firstInstallmentValue||a.installmentValue||0):(a.installmentValue||0);return{value,label:`${idx+1}/${a.installments} parcelas`,due,endDate,index:idx+1,total:a.installments||1,status:statusForDue(due)}}
function paymentKey(account,payment,date=viewDate){const month=iso(new Date(date.getFullYear(),date.getMonth(),1)).slice(0,7);const part=account.type==='installment'?(payment?.index||0):account.type;return `${account.id}::${month}::${part}`}
function isPaymentPaid(account,payment,date=viewDate){return !!state.paid?.[paymentKey(account,payment,date)]}
function setPaymentPaid(account,payment,paid,date=viewDate){state.paid ||= {};const key=paymentKey(account,payment,date);if(paid)state.paid[key]=true;else delete state.paid[key];saveState();render()}
function statusForDue(due){const today=new Date();today.setHours(0,0,0,0);const d=new Date(due);d.setHours(0,0,0,0);const diff=Math.ceil((d-today)/86400000);if(diff<0)return'Atrasada';if(diff<=5)return'Próxima';return'Em dia'}
function accountStatus(a,date){const p=getPaymentForMonth(a,date);if(p)return'current';if(a.type==='installment'){const first=parseDate(a.firstPaymentDate||a.purchaseDate);const end=addMonthsSafe(a.firstPaymentDate||a.purchaseDate,(a.installments||1)-1);if(first&&date<new Date(first.getFullYear(),first.getMonth(),1))return'future';if(end&&date>new Date(end.getFullYear(),end.getMonth(),1))return'finished'}if(a.type==='single'){const d=parseDate(a.purchaseDate);if(d&&date<new Date(d.getFullYear(),d.getMonth(),1))return'future';if(d&&date>new Date(d.getFullYear(),d.getMonth(),1))return'finished'}return'future'}
function estimateMonthlyRate(principal,payments){if(!principal||payments.length<2)return null;let low=-.99,high=1.5;const npv=r=>payments.reduce((acc,p,idx)=>acc+p/Math.pow(1+r,idx+1),0)-principal;if(npv(low)*npv(high)>0)return null;for(let i=0;i<90;i++){const mid=(low+high)/2;if(npv(mid)>0)low=mid;else high=mid}return(low+high)/2}
function interestInfo(a){if(a.type!=='installment'||!a.cashValue)return null;const total=accountTotalPaid(a);const interest=total-a.cashValue;const totalPercent=a.cashValue>0?(interest/a.cashValue)*100:0;const payments=Array.from({length:a.installments||1},(_,i)=>i===0&&a.hasDifferentFirst?(a.firstInstallmentValue||a.installmentValue||0):(a.installmentValue||0));const monthlyRate=estimateMonthlyRate(a.cashValue,payments);const avg=total/payments.length;const noInterest=a.cashValue/payments.length;const installmentUplift=noInterest?((avg/noInterest)-1)*100:0;let level='Baixo',cls='badge-good';if(monthlyRate!==null&&monthlyRate>.035){level='Abusivo';cls='badge-bad'}else if(monthlyRate!==null&&monthlyRate>.018){level='Médio';cls='badge-warn'}return{total,interest,totalPercent,monthlyRate,installmentUplift,level,cls}}

function riskLabel(rate){
  if(rate<=0)return {title:'Sem dados',text:'Informe renda e contas para calcular o nível de comprometimento.',cls:'neutral'};
  if(rate<=30)return {title:'Saudável',text:'Até 30% da renda comprometida. Boa margem para poupar e lidar com imprevistos.',cls:'good'};
  if(rate<=50)return {title:'Atenção',text:'Entre 30% e 50% da renda comprometida. Evite novas parcelas longas.',cls:'warn'};
  return {title:'Perigoso',text:'Acima de 50% da renda comprometida. Priorize quitar dívidas e reduzir contas fixas.',cls:'bad'};
}
function render(){
  const salary=salaryCalc();
  $('currentMonthLabel').textContent=`${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}`;
  $('netIncomeMetric').textContent=money(salary.net);
  const allPayments=state.accounts.map(a=>({account:a,payment:getPaymentForMonth(a,viewDate)})).filter(x=>x.payment);
  const payments=activeCategory==='Todas'?allPayments:allPayments.filter(x=>(x.account.category||'Outros')===activeCategory);
  const total=allPayments.reduce((s,x)=>s+x.payment.value,0);
  const paidTotal=allPayments.filter(x=>isPaymentPaid(x.account,x.payment)).reduce((s,x)=>s+x.payment.value,0);
  const unpaidTotal=total-paidTotal;
  const balance=salary.net-total;
  const cashAfterPaid=salary.net-paidTotal;
  const commitment=salary.net?(total/salary.net)*100:0;
  const risk=riskLabel(commitment);
  $('monthTotal').textContent=money(total);
  $('monthBalance').textContent=money(balance);
  $('monthBalance').style.color=balance<0?'var(--bad)':'var(--good)';
  $('activeAccounts').textContent=allPayments.length;
  $('riskMetric').textContent=salary.net?`${Math.round(commitment)}%`:'0%';
  $('riskMetric').style.color=commitment>50?'var(--bad)':commitment>30?'var(--warn)':'var(--good)';
  $('commitmentRate').textContent=salary.net?`${Math.round(commitment)}%`:'0%';
  $('fixedAccountsMetric').textContent=allPayments.filter(x=>x.account.type==='fixed').length;
  $('activeInstallments').textContent=allPayments.filter(x=>x.account.type==='installment').length;
  if($('paidThisMonth'))$('paidThisMonth').textContent=money(paidTotal);
  if($('unpaidThisMonth'))$('unpaidThisMonth').textContent=money(unpaidTotal);
  if($('cashAfterPaid'))$('cashAfterPaid').textContent=money(cashAfterPaid);
  const next=new Date(viewDate.getFullYear(),viewDate.getMonth()+1,1);
  $('endingNextMonth').textContent=state.accounts.filter(a=>a.type==='installment'&&sameMonth(addMonthsSafe(a.firstPaymentDate||a.purchaseDate,(a.installments||1)-1),next)).length;
  $('healthTitle').textContent=balance<0?'Mês no vermelho':balance<salary.net*.1?'Atenção no mês':'Mês saudável';
  $('healthText').textContent=salary.net?`Receita líquida estimada: ${money(salary.net)}. Após as contas deste mês, sobram ${money(balance)}.`:'Clique em “Renda e saldo” e informe seu salário bruto ou saldo disponível.';
  $('riskTitle').textContent=risk.title;
  $('riskText').textContent=risk.text;
  $('riskBar').style.width=`${Math.min(100,Math.round(commitment))}%`;
  $('riskBar').className=risk.cls;
  renderFilters();renderCalendar(allPayments);renderBills(payments);renderInterest();renderMonthGrid();renderFamilyPanel();
  renderMobileApp({salary,allPayments,payments,total,paidTotal,unpaidTotal,balance,cashAfterPaid,commitment,risk});
}

function renderMobileApp(data){
  const box=document.getElementById('mobileAppScreen');
  if(!box||!data)return;
  const {salary,allPayments,payments,total,paidTotal,unpaidTotal,balance,cashAfterPaid,commitment,risk}=data;
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value};
  set('mMonthLabel',`${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}`);
  set('mMonthSwitchLabel',`${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}`);
  set('mNetIncomeMetric',money(salary.net));
  set('mMonthTotal',money(total));
  set('mMonthBalance',money(balance));
  set('mRiskMetric',salary.net?`${Math.round(commitment)}%`:'0%');
  set('mActiveAccounts',allPayments.length);
  set('mPaidThisMonth',money(paidTotal));
  set('mUnpaidThisMonth',money(unpaidTotal));
  set('mCashAfterPaid',money(cashAfterPaid));
  set('mHealthText',salary.net?`${risk.title}. Sobram ${money(balance)} depois das contas do mês.`:'Informe sua renda para calcular o saldo do mês.');
  const bal=document.getElementById('mMonthBalance');if(bal)bal.style.color=balance<0?'var(--bad)':'var(--good)';
  const riskEl=document.getElementById('mRiskMetric');if(riskEl)riskEl.style.color=commitment>50?'var(--bad)':commitment>30?'var(--warn)':'var(--good)';

  const filters=document.getElementById('mCategoryFilters');
  if(filters){
    const cats=['Todas',...CATEGORIES];
    filters.innerHTML=cats.map(c=>`<button type="button" class="m-filter ${activeCategory===c?'active':''}" data-m-filter="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
    filters.querySelectorAll('[data-m-filter]').forEach(btn=>btn.onclick=()=>{activeCategory=btn.dataset.mFilter;render()});
  }

  const list=document.getElementById('mBillList');
  if(list){
    list.innerHTML=payments.length?payments.map(({account,payment})=>{
      const paid=isPaymentPaid(account,payment);const due=payment.due?formatDate(payment.due):'Sem data';
      return `<article class="m-bill-card ${paid?'paid':''}"><button type="button" class="m-bill-open" data-edit="${account.id}"><span>${escapeHtml(account.category||'Outros')}</span><strong>${escapeHtml(account.name)}</strong><small>${payment.label} • ${due}</small></button><div><b>${money(payment.value)}</b><button class="m-paid-btn ${paid?'active':''}" type="button" data-paid="${account.id}" data-key="${paymentKey(account,payment)}">${paid?'Paga':'Pagar'}</button></div></article>`
    }).join(''):'<div class="m-empty">Nenhuma conta ativa neste mês.</div>';
    list.querySelectorAll('[data-edit]').forEach(btn=>btn.onclick=()=>openAccount(btn.dataset.edit));
    list.querySelectorAll('[data-paid]').forEach(btn=>btn.onclick=()=>{const item=payments.find(x=>paymentKey(x.account,x.payment)===btn.dataset.key);if(item)setPaymentPaid(item.account,item.payment,!isPaymentPaid(item.account,item.payment));});
  }

  renderMobileCalendar(allPayments);

  const dueList=document.getElementById('mDueList');
  if(dueList){
    const ordered=[...allPayments].sort((a,b)=>(a.payment.due||0)-(b.payment.due||0));
    dueList.innerHTML=ordered.length?ordered.slice(0,12).map(({account,payment})=>`<button type="button" class="m-due-item" data-edit="${account.id}"><span>${payment.due?String(payment.due.getDate()).padStart(2,'0'):'--'}</span><div><strong>${escapeHtml(account.name)}</strong><small>${payment.status||'Em dia'} • ${money(payment.value)}</small></div></button>`).join(''):'<div class="m-empty">Sem vencimentos neste mês.</div>';
    dueList.querySelectorAll('[data-edit]').forEach(btn=>btn.onclick=()=>openAccount(btn.dataset.edit));
  }
}

function renderMobileCalendar(allPayments){
  const grid=document.getElementById('mCalendarGrid');
  if(!grid)return;
  const first=new Date(viewDate.getFullYear(),viewDate.getMonth(),1);
  const daysInMonth=new Date(viewDate.getFullYear(),viewDate.getMonth()+1,0).getDate();
  const offset=first.getDay();
  const byDay={};
  allPayments.forEach(x=>{const d=x.payment.due?x.payment.due.getDate():1;(byDay[d] ||= []).push(x)});
  const cells=[];
  ['D','S','T','Q','Q','S','S'].forEach(w=>cells.push(`<div class="m-calendar-weekday">${w}</div>`));
  for(let i=0;i<offset;i++)cells.push('<div class="m-calendar-day muted"></div>');
  for(let day=1;day<=daysInMonth;day++){
    const items=byDay[day]||[];
    const dayTotal=items.reduce((sum,x)=>sum+(x.payment.value||0),0);
    cells.push(`<button type="button" class="m-calendar-day ${items.length?'has-bills':''}" data-m-day="${day}"><span>${day}</span>${items.length?`<b>${money(dayTotal)}</b><small>${items.length} conta${items.length>1?'s':''}</small>`:''}</button>`);
  }
  grid.innerHTML=cells.join('');
  grid.querySelectorAll('[data-m-day]').forEach(btn=>btn.onclick=()=>{
    const items=byDay[Number(btn.dataset.mDay)]||[];
    if(items.length){
      const dueList=document.getElementById('mDueList');
      if(dueList){
        dueList.innerHTML=items.map(({account,payment})=>`<button type="button" class="m-due-item" data-edit="${account.id}"><span>${payment.due?String(payment.due.getDate()).padStart(2,'0'):'--'}</span><div><strong>${escapeHtml(account.name)}</strong><small>${payment.status||'Em dia'} • ${money(payment.value)}</small></div></button>`).join('');
        dueList.querySelectorAll('[data-edit]').forEach(btn=>btn.onclick=()=>openAccount(btn.dataset.edit));
        dueList.scrollIntoView({behavior:'smooth',block:'nearest'});
      }
    }
  });
}

function renderCalendar(allPayments){
  const first=new Date(viewDate.getFullYear(),viewDate.getMonth(),1);
  const daysInMonth=new Date(viewDate.getFullYear(),viewDate.getMonth()+1,0).getDate();
  const offset=first.getDay();
  const byDay={};
  allPayments.forEach(x=>{const d=x.payment.due?x.payment.due.getDate():1;(byDay[d] ||= []).push(x)});
  const cells=[];
  ['D','S','T','Q','Q','S','S'].forEach(w=>cells.push(`<div class="calendar-weekday">${w}</div>`));
  for(let i=0;i<offset;i++)cells.push('<div class="calendar-day muted"></div>');
  for(let day=1;day<=daysInMonth;day++){
    const items=byDay[day]||[];
    const dayTotal=items.reduce((s,x)=>s+x.payment.value,0);
    cells.push(`<button type="button" class="calendar-day ${items.length?'has-bills':''}" data-day="${day}"><span>${day}</span>${items.length?`<b>${money(dayTotal)}</b><small>${items.length} conta${items.length>1?'s':''}</small>`:''}</button>`);
  }
  $('calendarGrid').innerHTML=cells.join('');
  document.querySelectorAll('[data-day]').forEach(btn=>btn.onclick=()=>{
    const items=byDay[Number(btn.dataset.day)]||[];
    if(items.length){activeCategory='Todas';renderBills(items);document.querySelector('.bill-groups')?.scrollIntoView({behavior:'smooth',block:'start'});}
  });
}
function renderFilters(){const cats=['Todas',...CATEGORIES];$('categoryFilters').innerHTML=cats.map(c=>`<button type="button" class="filter-btn ${activeCategory===c?'active':''}" data-filter="${c}">${c}</button>`).join('');document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{activeCategory=b.dataset.filter;render()})}
function billCard(account,payment){const paid=isPaymentPaid(account,payment);const pct=payment.total?Math.round((payment.index/payment.total)*100):100;return`<div class="bill-row ${paid?'paid':''}"><button class="bill-main" type="button" data-edit="${account.id}"><div><h3>${escapeHtml(account.name)}</h3><div class="bill-meta"><span class="pill">${escapeHtml(account.category||'Outros')}</span><span class="pill">${payment.label}</span>${payment.due?`<span class="pill ${paid?'paid-pill':''}">${paid?'Paga':payment.status}: ${formatDate(payment.due)}</span>`:''}${payment.endDate?`<span class="pill">Finaliza ${formatDate(payment.endDate)}</span>`:''}</div>${payment.total?`<div class="progress"><i style="width:${pct}%"></i></div>`:''}</div><div class="bill-value">${money(payment.value)}<small>editar</small></div></button><button class="paid-toggle ${paid?'active':''}" type="button" data-paid="${account.id}" data-key="${paymentKey(account,payment)}">${paid?'✓ Paga':'Marcar paga'}</button></div>`}
function renderBills(payments){const current=payments;const future=state.accounts.filter(a=>accountStatus(a,viewDate)==='future'&&(activeCategory==='Todas'||(a.category||'Outros')===activeCategory));const finished=state.accounts.filter(a=>accountStatus(a,viewDate)==='finished'&&(activeCategory==='Todas'||(a.category||'Outros')===activeCategory));const parts=[];parts.push(`<div><div class="group-title"><span>Em andamento</span><span>${current.length}</span></div><div class="bill-list">${current.length?current.map(x=>billCard(x.account,x.payment)).join(''):'<div class="empty">Nenhuma conta ativa neste mês.</div>'}</div></div>`);parts.push(`<div><div class="group-title"><span>Futuras</span><span>${future.length}</span></div><div class="bill-list">${future.length?future.slice(0,5).map(a=>`<button class="bill-row" type="button" data-edit="${a.id}"><div><h3>${escapeHtml(a.name)}</h3><div class="bill-meta"><span class="pill">${escapeHtml(a.category||'Outros')}</span><span class="pill">Começa em ${formatDate(parseDate(a.firstPaymentDate||a.purchaseDate))}</span></div></div><div class="bill-value">${money(a.type==='fixed'?a.fixedValue:a.installmentValue)}<small>editar</small></div></button>`).join(''):'<div class="empty">Nenhuma conta futura.</div>'}</div></div>`);parts.push(`<div><div class="group-title"><span>Finalizadas</span><span>${finished.length}</span></div><div class="bill-list">${finished.length?finished.slice(0,5).map(a=>`<button class="bill-row" type="button" data-edit="${a.id}"><div><h3>${escapeHtml(a.name)}</h3><div class="bill-meta"><span class="pill">${escapeHtml(a.category||'Outros')}</span><span class="pill">Finalizada</span></div></div><div class="bill-value">${money(accountTotalPaid(a))}<small>editar</small></div></button>`).join(''):'<div class="empty">Nenhuma conta finalizada.</div>'}</div></div>`);$('billGroups').innerHTML=parts.join('');document.querySelectorAll('[data-edit]').forEach(btn=>btn.onclick=()=>openAccount(btn.dataset.edit));document.querySelectorAll('[data-paid]').forEach(btn=>btn.onclick=()=>{const item=payments.find(x=>paymentKey(x.account,x.payment)===btn.dataset.key);if(item)setPaymentPaid(item.account,item.payment,!isPaymentPaid(item.account,item.payment));})}
function renderInterest(){const items=state.accounts.map(a=>({a,i:interestInfo(a)})).filter(x=>x.i);$('interestList').innerHTML=items.length?items.map(({a,i})=>`<div class="interest-item"><strong>${escapeHtml(a.name)}</strong><p>Total pago: <b>${money(i.total)}</b><br>Juros em R$: <b>${money(i.interest)}</b><br>Juros total: <b>${i.totalPercent.toFixed(2)}%</b><br>Aumento médio por parcela: <b>${i.installmentUplift.toFixed(2)}%</b><br>Taxa mensal estimada: <b>${i.monthlyRate===null?'indefinida':`${(i.monthlyRate*100).toFixed(2)}% a.m.`}</b></p><span class="interest-badge ${i.cls}">${i.level}</span></div>`).join(''):'<div class="empty">Preencha “valor à vista” nas contas parceladas para calcular juros.</div>'}
function renderMonthGrid(){$('pickerYearLabel').textContent=pickerYear;$('monthGrid').innerHTML=MONTHS.map((m,i)=>`<button type="button" class="month-option ${viewDate.getMonth()===i&&viewDate.getFullYear()===pickerYear?'active':''}" data-month="${i}">${m.slice(0,3)}</button>`).join('');document.querySelectorAll('[data-month]').forEach(btn=>btn.onclick=()=>{viewDate=new Date(pickerYear,Number(btn.dataset.month),1);$('monthPicker').classList.add('hidden');render()})}

function populateCategories(){$('category').innerHTML=CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('')}
function openAccount(id=null){const a=id?state.accounts.find(x=>x.id===id):null;$('dialogTitle').textContent=a?'Editar conta':'Nova conta';$('accountId').value=a?.id||'';$('accountName').value=a?.name||'';$('category').value=a?.category||'Outros';$('accountType').value=a?.type||'installment';$('purchaseDate').value=a?.purchaseDate||iso(new Date());$('firstPaymentDate').value=a?.firstPaymentDate||a?.purchaseDate||iso(new Date());$('installments').value=a?.installments||1;$('installmentValue').value=a?.installmentValue||'';$('fixedValue').value=a?.fixedValue||'';$('cashValue').value=a?.cashValue||'';$('hasDifferentFirst').checked=!!a?.hasDifferentFirst;$('firstInstallmentValue').value=a?.firstInstallmentValue||'';$('deleteAccountBtn').classList.toggle('hidden',!a);updateSmartForm();$('accountDialog').showModal()}
function closeAccount(){$('accountDialog').close()}
function readForm(){return{id:$('accountId').value||crypto.randomUUID(),name:$('accountName').value.trim(),category:$('category').value,type:$('accountType').value,purchaseDate:$('purchaseDate').value,firstPaymentDate:$('firstPaymentDate').value||$('purchaseDate').value,installments:Math.max(1,parseInt($('installments').value||'1',10)),installmentValue:toNumber($('installmentValue').value),fixedValue:toNumber($('fixedValue').value),cashValue:toNumber($('cashValue').value),hasDifferentFirst:$('hasDifferentFirst').checked,firstInstallmentValue:toNumber($('firstInstallmentValue').value)}}
function updateSmartForm(){const type=$('accountType').value;document.querySelectorAll('.installment-only').forEach(el=>el.classList.toggle('hidden',type!=='installment'));document.querySelectorAll('.fixed-only').forEach(el=>el.classList.toggle('hidden',type!=='fixed'));document.querySelectorAll('.installment-or-single').forEach(el=>el.classList.toggle('hidden',type==='fixed'));$('firstValueWrap').classList.toggle('hidden',!$('hasDifferentFirst').checked||type!=='installment');const temp=readForm();const total=accountTotalPaid(temp);const end=temp.type==='installment'?addMonthsSafe(temp.firstPaymentDate||temp.purchaseDate,(temp.installments||1)-1):null;const info=interestInfo(temp);$('calcPreview').innerHTML=temp.type==='fixed'?`Conta fixa mensal de <b>${money(temp.fixedValue)}</b>, iniciando em <b>${formatDate(parseDate(temp.purchaseDate))}</b>.`:`Total previsto: <b>${money(total)}</b>${end?`<br>Última parcela prevista: <b>${formatDate(end)}</b>`:''}${info?`<br>Juros estimados: <b>${money(info.interest)}</b> / <b>${info.totalPercent.toFixed(2)}%</b> sobre o valor à vista.`:''}`}
function saveAccount(e){e.preventDefault();const account=readForm();if(!account.name)return;const idx=state.accounts.findIndex(a=>a.id===account.id);if(idx>=0)state.accounts[idx]=account;else state.accounts.push(account);saveState();closeAccount();render()}
function deleteAccount(){const id=$('accountId').value;state.accounts=state.accounts.filter(a=>a.id!==id);saveState();closeAccount();render()}

function fillSalaryFields(prefix, salary){
  $(prefix+'Gross').value=salary.gross||'';
}
function openSettings(){const s=normalizeSalary(state.salary);state.salary=s;$('grossSalary').value=s.gross||'';$('salaryName1').value=s.name||'';$('manualBalance').value=s.manualExtra||'';$('useSecondSalary').checked=!!s.useSecondSalary;$('useINSS').checked=!!s.useINSS;$('showFGTS').checked=!!s.showFGTS;$('useTransport').checked=!!s.useTransport;$('useFood').checked=!!s.useFood;$('foodMode').value=s.foodMode||'value';$('foodValue').value=s.foodValue||'';$('useHealth').checked=!!s.useHealth;$('healthMode').value=s.healthMode||'value';$('healthValue').value=s.healthValue||'';const s2=s.second||defaultSalary();$('grossSalary2').value=s2.gross||'';$('salaryName2').value=s2.name||'';$('useINSS2').checked=!!s2.useINSS;$('showFGTS2').checked=!!s2.showFGTS;$('useTransport2').checked=!!s2.useTransport;$('useFood2').checked=!!s2.useFood;$('foodMode2').value=s2.foodMode||'value';$('foodValue2').value=s2.foodValue||'';$('useHealth2').checked=!!s2.useHealth;$('healthMode2').value=s2.healthMode||'value';$('healthValue2').value=s2.healthValue||'';updateSalaryPreview();$('settingsDialog').showModal()}
function readSalaryPerson(suffix=''){return{name:$('salaryName'+(suffix||'1')).value.trim(),gross:toNumber($('grossSalary'+suffix).value),useINSS:$('useINSS'+suffix).checked,showFGTS:$('showFGTS'+suffix).checked,useTransport:$('useTransport'+suffix).checked,useFood:$('useFood'+suffix).checked,foodMode:$('foodMode'+suffix).value,foodValue:toNumber($('foodValue'+suffix).value),useHealth:$('useHealth'+suffix).checked,healthMode:$('healthMode'+suffix).value,healthValue:toNumber($('healthValue'+suffix).value)}}
function readSalaryForm(){return{...readSalaryPerson(''),manualExtra:toNumber($('manualBalance').value),useSecondSalary:$('useSecondSalary').checked,second:readSalaryPerson('2')}}
function salaryBlock(title,c){return`<div class="salary-person-preview"><strong>${escapeHtml(title)}</strong><div class="line"><span>Salário bruto</span><b>${money(c.gross)}</b></div><div class="line"><span>INSS</span><b>-${money(c.inss)}</b></div><div class="line"><span>FGTS estimado, não descontado</span><b>${money(c.fgts)}</b></div><div class="line"><span>Vale-transporte</span><b>-${money(c.transport)}</b></div><div class="line"><span>Vale alimentação</span><b>-${money(c.food)}</b></div><div class="line"><span>Plano de saúde</span><b>-${money(c.health)}</b></div><div class="line"><span>Líquido da pessoa</span><b>${money(c.net)}</b></div></div>`}
function updateSalaryPreview(){const old=state.salary;state.salary=readSalaryForm();$('secondSalarySection').classList.toggle('hidden',!state.salary.useSecondSalary);const c=salaryCalc();state.salary=old;const title1=c.first.name||'Salário 1';const title2=c.second?(c.second.name||'Salário 2'):'';$('salaryPreview').innerHTML=`${salaryBlock(title1,c.first)}${c.second?salaryBlock(title2,c.second):''}<div class="salary-total-preview"><div class="line"><span>Bruto total</span><b>${money(c.gross)}</b></div><div class="line"><span>Descontos totais</span><b>-${money(c.totalDeductions)}</b></div><div class="line"><span>FGTS total informativo</span><b>${money(c.fgts)}</b></div><div class="line"><span>Saldo manual extra</span><b>${money(c.manualExtra)}</b></div><div class="line total"><span>Líquido total usado pelo app</span><b>${money(c.net)}</b></div></div>`}
function saveSettings(e){e.preventDefault();state.salary=readSalaryForm();saveState();$('settingsDialog').close();render()}


function setProfilePreview(photo,name,email){
  const img=$('profilePreviewImg');
  if(!img)return;
  const safeName=name||currentUser?.displayName||currentUser?.email||'Usuário';
  const safeEmail=email||currentUser?.email||'';
  $('profilePreviewName').textContent=safeName;
  $('profilePreviewEmail').textContent=safeEmail;
  if(photo){img.src=photo;img.classList.remove('empty-avatar');img.alt=`Foto de ${safeName}`;}
  else{img.removeAttribute('src');img.classList.add('empty-avatar');img.alt='Sem foto';img.dataset.initial=avatarFallback(safeName,safeEmail);}
}

function memberDisplayName(m){return m?.nickname||m?.name||m?.email||'Membro'}
function isFamilyLinked(){return (workspaceMembers||[]).length>1}
function renderMemberRows(){
  const members=workspaceMembers||[];
  if(!members.length)return '<div class="empty small-empty">Nenhum membro carregado ainda.</div>';
  return members.map(m=>{
    const me=currentUser&&m.uid===currentUser.uid;
    const owner=currentGroup&&m.uid===currentGroup.ownerUid;
    const name=memberDisplayName(m);
    return `<div class="member-row group-member-row">${m.photoURL?`<img src="${escapeHtml(m.photoURL)}" alt="">`:`<span>${escapeHtml(avatarFallback(name,m.email))}</span>`}<div><strong>${escapeHtml(name)} ${me?'<em>você</em>':''}</strong><small>${escapeHtml(m.email||'')}${owner?' • criou o grupo':''}</small></div></div>`;
  }).join('');
}
function renderFamilyPanel(){
  const linked=isFamilyLinked();
  const inviteArea=$('familyInviteArea');
  const linkedArea=$('familyLinkedArea');
  if(inviteArea)inviteArea.classList.toggle('hidden',linked);
  if(linkedArea)linkedArea.classList.toggle('hidden',!linked);
  if($('familyCardTitle'))$('familyCardTitle').textContent=linked?'Seu grupo financeiro':'Casal / família';
  if($('familyCardText'))$('familyCardText').textContent=linked?'Você está vinculado a um controle compartilhado. Os dados financeiros são sincronizados entre os membros.':'Crie ou cole um convite para compartilhar o mesmo controle financeiro.';
  if($('familyMiniMembers'))$('familyMiniMembers').innerHTML=linked?renderMemberRows():'<div class="empty small-empty">Você ainda está em um controle individual.</div>';
  if($('groupDetails')){
    const groupName=currentGroup?.name||'Controle financeiro';
    const invite=currentGroup?.lastInviteCode?inviteLinkFromCode(currentGroup.lastInviteCode):($('inviteOutput')?.value||'');
    $('groupDetails').innerHTML=`<div class="group-summary"><span class="eyebrow">Nome do grupo</span><h3>${escapeHtml(groupName)}</h3><p>${linked?'Grupo compartilhado ativo.':'Controle individual. Convide seu cônjuge para compartilhar.'}</p></div><div class="group-members-list"><span class="eyebrow">Pessoas vinculadas</span>${renderMemberRows()}</div><label class="field full"><span>Último convite</span><input id="groupInviteMirror" type="text" readonly value="${escapeHtml(invite)}" placeholder="Nenhum convite criado ainda" /></label>`;
  }
}
async function refreshGroupInfo(){
  if(!workspaceId)return;
  currentGroup=await carregarGrupoWorkspace(workspaceId).catch(()=>null);
  workspaceMembers=await carregarMembrosWorkspace(workspaceId).catch(()=>[]);
  renderFamilyPanel();renderProfileMembers();
}
async function createInviteFlow(){
  if(!currentUser||!workspaceId)throw new Error('Faça login primeiro.');
  const code=await criarConvite(workspaceId,currentUser);
  const link=inviteLinkFromCode(code);
  if($('inviteOutput'))$('inviteOutput').value=link;
  await refreshGroupInfo();
  if($('groupInviteMirror'))$('groupInviteMirror').value=link;
  setCloudStatus(`Convite criado: ${code}`);
  return link;
}
async function copyInviteFlow(){
  let value=$('inviteOutput')?.value||$('groupInviteMirror')?.value||'';
  if(!value&&currentGroup?.lastInviteCode)value=inviteLinkFromCode(currentGroup.lastInviteCode);
  if(!value)value=await createInviteFlow();
  try{await navigator.clipboard.writeText(value);setCloudStatus('Link copiado. Envie para quem entrará no grupo.');}
  catch{setCloudStatus('Não consegui copiar automaticamente. Copie o campo manualmente.');}
}
async function leaveGroupFlow(){
  if(!currentUser||!workspaceId)return setCloudStatus('Faça login primeiro.');
  if(!confirm('Deseja sair deste grupo financeiro? Você irá para um controle individual novo.'))return;
  try{
    const oldId=workspaceId;
    workspaceId=await sairDoWorkspaceAtual(currentUser,oldId);
    const remote=await carregarDadosWorkspace(workspaceId);
    state=remote&&Array.isArray(remote.accounts)?{...defaultState(),...remote,paid:remote.paid||{},salary:normalizeSalary(remote.salary||{})}:defaultState();
    localStorage.setItem(STORE,JSON.stringify(state));
    isCloudReady=true;
    await refreshGroupInfo();
    render();
    setCloudStatus('Você saiu do grupo e agora está em um controle individual.');
    if($('groupDialog')?.open)$('groupDialog').close();
  }catch(err){console.error(err);setCloudStatus(err.message||'Não consegui sair do grupo.');}
}
function openGroup(){renderFamilyPanel();$('groupDialog')?.showModal();}

function renderProfileMembers(){
  const box=$('profileMembers');
  if(!box)return;
  const members=workspaceMembers||[];
  box.innerHTML=`<span class="eyebrow">Membros do controle compartilhado</span>${members.length?members.map(m=>`<div class="member-row">${m.photoURL?`<img src="${escapeHtml(m.photoURL)}" alt="">`:`<span>${escapeHtml(avatarFallback(m.name,m.email))}</span>`}<div><strong>${escapeHtml(m.name||'Membro')}</strong><small>${escapeHtml(m.nickname||m.email||'')}</small></div></div>`).join(''):'<div class="empty small-empty">Nenhum outro membro encontrado ainda.</div>'}`;
}
async function imageFileToDataUrl(file){
  if(!file)return'';
  if(!file.type.startsWith('image/'))throw new Error('Escolha um arquivo de imagem.');
  const bitmap=await createImageBitmap(file);
  const max=420;
  const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(bitmap.width*scale);
  canvas.height=Math.round(bitmap.height*scale);
  const ctx=canvas.getContext('2d');
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',0.82);
}
function openProfile(){
  const p=currentProfile||{};
  const name=p.name||currentUser?.displayName||'';
  const email=currentUser?.email||p.email||'';
  const photo=p.photoURL||currentUser?.photoURL||'';
  $('profileName').value=name;
  $('profileNickname').value=p.nickname||'';
  $('profileTheme').value=p.theme||'dark';
  $('profileCompactMode').checked=!!p.compactMode;
  $('profilePhotoUrl').value=photo && !photo.startsWith('data:') ? photo : '';
  $('profilePhotoFile').value='';
  setProfilePreview(photo,name,email);
  renderProfileMembers();
  $('profileDialog').showModal();
}
async function saveProfile(e){
  e.preventDefault();
  if(!currentUser)return;
  const file=$('profilePhotoFile').files?.[0];
  let photoURL=$('profilePhotoUrl').value.trim() || currentProfile?.photoURL || currentUser.photoURL || '';
  try{
    if(file) photoURL=await imageFileToDataUrl(file);
    const profile={
      name:$('profileName').value.trim()||currentUser.displayName||currentUser.email||'Usuário',
      photoURL,
      nickname:$('profileNickname').value.trim(),
      theme:$('profileTheme').value,
      compactMode:$('profileCompactMode').checked
    };
    currentProfile=await salvarPerfilUsuario(currentUser,profile);
    await refreshGroupInfo();
    applyProfileTheme();
    renderUserChip();
    $('profileDialog').close();
    setCloudStatus('Perfil atualizado com sucesso.');
  }catch(err){console.error(err);alert(err.message||'Não consegui salvar o perfil.');}
}

function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`financi-backup-${iso(new Date())}.json`;a.click();URL.revokeObjectURL(a.href)}
function importData(file){if(!file)return;const r=new FileReader();r.onload=()=>{try{const data=JSON.parse(r.result);if(!data||!Array.isArray(data.accounts))throw new Error('Arquivo inválido');state={...defaultState(),...data,paid:data.paid||{},salary:normalizeSalary(data.salary||{})};saveState();render();alert('Backup importado com sucesso.')}catch{alert('Não consegui importar este arquivo JSON.')}};r.readAsText(file)}

populateCategories();
$('prevMonthBtn').onclick=()=>{viewDate=new Date(viewDate.getFullYear(),viewDate.getMonth()-1,1);pickerYear=viewDate.getFullYear();render()};
$('nextMonthBtn').onclick=()=>{viewDate=new Date(viewDate.getFullYear(),viewDate.getMonth()+1,1);pickerYear=viewDate.getFullYear();render()};
$('monthPickerBtn').onclick=()=>$('monthPicker').classList.toggle('hidden');$('yearDownBtn').onclick=()=>{pickerYear--;renderMonthGrid()};$('yearUpBtn').onclick=()=>{pickerYear++;renderMonthGrid()};
$('openAccountBtn').onclick=()=>openAccount();$('closeAccountBtn').onclick=closeAccount;$('cancelAccountBtn').onclick=closeAccount;$('accountForm').onsubmit=saveAccount;$('deleteAccountBtn').onclick=deleteAccount;
$('openSettingsBtn').onclick=openSettings;$('closeSettingsBtn').onclick=()=>$('settingsDialog').close();$('cancelSettingsBtn').onclick=()=>$('settingsDialog').close();$('settingsForm').onsubmit=saveSettings;
$('openProfileBtn')?.addEventListener('click',openProfile);$('openGroupBtn')?.addEventListener('click',openGroup);$('openGroupCardBtn')?.addEventListener('click',openGroup);$('closeGroupBtn')?.addEventListener('click',()=>$('groupDialog').close());$('createInviteModalBtn')?.addEventListener('click',async()=>{try{await createInviteFlow();renderFamilyPanel();}catch(err){console.error(err);setCloudStatus(err.message||'Erro ao criar convite.')}});$('copyInviteModalBtn')?.addEventListener('click',copyInviteFlow);$('leaveGroupBtn')?.addEventListener('click',leaveGroupFlow);$('leaveGroupModalBtn')?.addEventListener('click',leaveGroupFlow);$('closeProfileBtn')?.addEventListener('click',()=>$('profileDialog').close());$('cancelProfileBtn')?.addEventListener('click',()=>$('profileDialog').close());$('profileForm')?.addEventListener('submit',saveProfile);$('profilePhotoFile')?.addEventListener('change',async(e)=>{try{const url=await imageFileToDataUrl(e.target.files?.[0]);if(url)setProfilePreview(url,$('profileName').value,currentUser?.email)}catch(err){alert(err.message)}});$('profilePhotoUrl')?.addEventListener('input',()=>setProfilePreview($('profilePhotoUrl').value.trim(),$('profileName').value,currentUser?.email));$('profileName')?.addEventListener('input',()=>setProfilePreview($('profilePhotoUrl').value.trim()||currentProfile?.photoURL||currentUser?.photoURL,$('profileName').value,currentUser?.email));
$('exportBtn').onclick=exportData;$('importBtn').onclick=()=>$('importFile').click();$('importFile').onchange=e=>importData(e.target.files[0]);
['accountType','purchaseDate','firstPaymentDate','installments','installmentValue','fixedValue','cashValue','hasDifferentFirst','firstInstallmentValue','category'].forEach(id=>$(id).addEventListener('input',updateSmartForm));
['grossSalary','salaryName1','manualBalance','useSecondSalary','useINSS','showFGTS','useTransport','useFood','foodMode','foodValue','useHealth','healthMode','healthValue','grossSalary2','salaryName2','useINSS2','showFGTS2','useTransport2','useFood2','foodMode2','foodValue2','useHealth2','healthMode2','healthValue2'].forEach(id=>$(id).addEventListener('input',updateSalaryPreview));
$('logoutBtn')?.addEventListener('click',()=>sairDoGoogle());
$('createInviteBtn')?.addEventListener('click',async()=>{try{await createInviteFlow();}catch(err){console.error(err);setCloudStatus(err.message||'Erro ao criar convite.')}});
$('copyInviteBtn')?.addEventListener('click',copyInviteFlow);
$('joinInviteBtn')?.addEventListener('click',async()=>{
  try{
    if(!currentUser)throw new Error('Faça login primeiro.');
    const code=extrairCodigoConvite($('joinCode').value);
    if(!code)throw new Error('Cole um código ou link de convite.');
    workspaceId=await entrarPorConvite(code,currentUser);
    const remote=await carregarDadosWorkspace(workspaceId);
    if(remote&&Array.isArray(remote.accounts)){state={...defaultState(),...remote,paid:remote.paid||{},salary:normalizeSalary(remote.salary||{})};localStorage.setItem(STORE,JSON.stringify(state));}
    isCloudReady=true;await refreshGroupInfo();render();setCloudStatus('Você entrou no controle compartilhado com sucesso.');
  }catch(err){console.error(err);setCloudStatus(err.message||'Não consegui entrar pelo convite.')}
});



showLoggedOut();
initAuth();

/* V5.4 - controles mobile independentes; não altera o layout desktop */
function closeMobileMoreMenus(){
  document.querySelectorAll('.mobile-more[open]').forEach(d=>d.removeAttribute('open'));
}
function setupMobileShell(){
  const syncMonth=()=>{const src=document.getElementById('currentMonthLabel');const dst=document.getElementById('mobileMonthLabel');if(src&&dst)dst.textContent=src.textContent||'Mês atual'};
  syncMonth();
  const monthLabel=document.getElementById('currentMonthLabel');
  if(monthLabel){new MutationObserver(syncMonth).observe(monthLabel,{childList:true,characterData:true,subtree:true});}
  document.querySelectorAll('[data-mobile-click]').forEach(btn=>btn.addEventListener('click',()=>{
    const target=document.getElementById(btn.dataset.mobileClick);
    target?.click();
    closeMobileMoreMenus();
  }));
  document.querySelectorAll('[data-mobile-scroll]').forEach(btn=>btn.addEventListener('click',()=>{
    document.getElementById(btn.dataset.mobileScroll)?.scrollIntoView({behavior:'smooth',block:'start'});
    closeMobileMoreMenus();
  }));
  document.querySelectorAll('.mobile-bottom-nav a').forEach(link=>link.addEventListener('click',closeMobileMoreMenus));

  document.addEventListener('pointerdown',(event)=>{
    const opened=document.querySelector('.mobile-more[open]');
    if(!opened) return;
    if(!opened.contains(event.target)) closeMobileMoreMenus();
  },true);

  document.addEventListener('keydown',(event)=>{
    if(event.key==='Escape') closeMobileMoreMenus();
  });
}
setupMobileShell();

/* V6.2 - trava o fundo e libera rolagem interna dos modais no mobile */
(function setupMobileDialogScrollLock(){
  const dialogs=[...document.querySelectorAll('dialog.modal')];
  let lockedScrollY=0;
  const isMobile=()=>window.matchMedia('(max-width: 760px)').matches;
  const anyOpen=()=>dialogs.some(d=>d.open);

  function lockPage(){
    if(!isMobile()) return;
    if(document.body.classList.contains('mobile-dialog-open')) return;
    lockedScrollY=window.scrollY||document.documentElement.scrollTop||0;
    document.documentElement.classList.add('mobile-dialog-open');
    document.body.classList.add('mobile-dialog-open');
    document.body.style.position='fixed';
    document.body.style.top=`-${lockedScrollY}px`;
    document.body.style.left='0';
    document.body.style.right='0';
    document.body.style.width='100%';
  }

  function unlockPage(){
    if(anyOpen()) return;
    document.documentElement.classList.remove('mobile-dialog-open');
    document.body.classList.remove('mobile-dialog-open');
    document.body.style.position='';
    document.body.style.top='';
    document.body.style.left='';
    document.body.style.right='';
    document.body.style.width='';
    if(isMobile()) window.scrollTo(0,lockedScrollY);
  }

  dialogs.forEach(dialog=>{
    new MutationObserver(()=>{
      if(dialog.open){
        lockPage();
        const card=dialog.querySelector('.modal-card');
        if(card) card.scrollTop=0;
      }else{
        unlockPage();
      }
    }).observe(dialog,{attributes:true,attributeFilter:['open']});
    dialog.addEventListener('close',unlockPage);
    dialog.addEventListener('cancel',unlockPage);
  });

  window.addEventListener('resize',()=>{
    if(!isMobile()) unlockPage();
    else if(anyOpen()) lockPage();
  });
})();
