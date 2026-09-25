const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../js/transfer-payments.js'),'utf8');
const sandbox = { Uint8Array, URL, setTimeout };
vm.runInNewContext(source,sandbox);
const api = sandbox.LasNanasTransfers;
function file(size=128,type='application/pdf',signature=[37,80,68,70,45]) {
  return { name:'receipt.pdf', size,type,slice:()=>({arrayBuffer:async()=>Uint8Array.from(signature).buffer}) };
}
function mock({existing=null,uploadError=null,finalizeError=null}={}) {
  const calls=[];
  const client={
    from(name){ assert.equal(name,'transfer_receipts');const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:existing};}};return q; },
    async rpc(name,args){calls.push(name);
      if(name==='reserve_transfer_receipt_upload') return {data:[{receipt_id:'receipt-a',storage_path:'a/app/receipt.pdf'}]};
      assert.equal(name,'finalize_transfer_receipt_upload');
      if(finalizeError)return {error:finalizeError};
      return {data:[{receipt_id:args.p_receipt_id,received_at:'2026-09-23T00:00:00Z'}]};
    },
    storage:{from(bucket){assert.equal(bucket,'transfer-receipts');return {async upload(route,binary,options){
      calls.push('upload');assert.equal(route,'a/app/receipt.pdf');assert.equal(options.upsert,false);
      assert.equal(options.contentType,binary.type);return {error:uploadError};
    }};}}
  };
  return {service:api.createService(client),calls};
}
test('valid files include the exact 5 MiB boundary',async()=>{
  await api.validate(file(api.MAX_BYTES));
  await api.validate(file(8,'image/png',[137,80,78,71,13,10,26,10]));
  await api.validate(file(3,'image/jpeg',[255,216,255]));
});
test('oversize, empty, disallowed and false signatures are rejected',async()=>{
  for(const f of [file(api.MAX_BYTES+1),file(0),file(100,'image/svg+xml'),file(100,'application/pdf',[1,2,3])])
    await assert.rejects(api.validate(f),/invalid_receipt_file/);
});
test('upload then finalize, without any payment confirmation call',async()=>{
  const m=mock();const result=await m.service.upload('app',file());
  assert.ok(result.received_at);
  assert.deepEqual(m.calls,['reserve_transfer_receipt_upload','upload','finalize_transfer_receipt_upload']);
});
test('existing uploaded reservation retries finalization without overwriting',async()=>{
  const m=mock({existing:{id:'receipt-a',status:'reserved'}});
  await m.service.upload('app',file());assert.deepEqual(m.calls,['finalize_transfer_receipt_upload']);
});
test('failed finalization never reports a received receipt',async()=>{
  const m=mock({finalizeError:{message:'receipt_object_metadata_mismatch'}});
  await assert.rejects(m.service.upload('app',file()),e=>e.message==='receipt_object_metadata_mismatch');
});
test('failed binary upload is not reported as received when no object exists',async()=>{
  const m=mock({uploadError:{message:'network error'},finalizeError:{message:'receipt_object_not_found'}});
  await assert.rejects(m.service.upload('app',file()),e=>e.message==='network error');
});
test('lost upload response can recover only through server finalization',async()=>{
  const m=mock({uploadError:{message:'response lost'}});
  assert.ok((await m.service.upload('app',file())).received_at);
});
test('received receipts are not uploaded again',async()=>{
  const m=mock({existing:{id:'receipt-a',status:'received'}});
  assert.equal((await m.service.upload('app',file())).status,'received');assert.equal(m.calls.length,0);
});
const testBank={holder:'Test',taxId:'Test',bankName:'Test',accountType:'Test',accountNumber:'Test',referenceInstructions:'Test'};
test('payment configuration requires complete bank details, without currency matching',()=>{
  assert.equal(api.configured({enabled:true,bank:testBank}),true);
  assert.equal(api.configured({enabled:false,bank:testBank}),false);
  assert.equal(api.configured({enabled:true,bank:{...testBank,accountNumber:''}}),false);
});
test('CLP USD and EUR origins are allowed independently of quoted currency',()=>{
  for(const origin of ['CLP','USD','EUR']) assert.equal(api.canSend({enabled:true,bank:testBank},'domestic',origin),true);
});
test('international route requires explicit confirmation and complete instructions for every origin',()=>{
  for(const origin of ['CLP','USD','EUR']) {
    const config={enabled:true,bank:testBank};
    assert.equal(api.canSend(config,'international',origin),false);
    assert.equal(api.canSend({...config,international:{confirmed:true,instructions:[]}},'international',origin),false);
    assert.equal(api.canSend({...config,international:{confirmed:false,instructions:['Verified bank instructions']}},'international',origin),false);
    assert.equal(api.canSend({...config,international:{confirmed:true,instructions:['Verified bank instructions']}},'international',origin),true);
  }
});
test('route must be selected explicitly, not inferred from origin currency',()=>{
  assert.equal(api.canSend({enabled:true,bank:testBank},'', 'USD'),false);
});
test('portal preserves USD quote for EUR origin and hides unconfirmed international bank details',async()=>{
  const nodes=new Map();
  const node=()=>({value:'',hidden:false,textContent:'',children:[],addEventListener(){},replaceChildren(){this.children=[];},append(p){this.children.push(p);},querySelectorAll(){return [];}});
  const select=key=>{if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);};
  sandbox.document={createElement:node};
  const client={from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:null};}};return q;}};
  const section={querySelector:select};
  select('[data-transfer-source-currency]').value='EUR';
  select('[data-transfer-route]').value='domestic';
  const app=Object.freeze({id:'a',status:'approved',quoted_amount:15,currency:'USD'});
  const actualConfig={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/transfer-config.js'),'utf8'),actualConfig);
  const panel=api.mountVolunteer(client,actualConfig.window.LAS_NANAS_TRANSFER,section);
  await panel.refresh(app);
  assert.match(select('[data-transfer-quote]').textContent,/15 USD/);
  assert.equal(select('[data-receipt-form]').hidden,false);
  const visibleInstructions=select('[data-transfer-instructions]').children.map(p=>p.textContent).join('\n');
  for(const value of ['Chakrasur','77.311.825-6','Banco Estado','725-7-025245-4','Código de tu solicitud: a'])
    assert.ok(visibleInstructions.includes(value));
  select('[data-transfer-route]').value='international';
  await panel.refresh(app);
  assert.equal(select('[data-transfer-instructions]').children.length,0);
  assert.equal(select('[data-receipt-form]').hidden,true);
  assert.match(select('[data-transfer-quote]').textContent,/15 USD/);
});
test('authorized configuration enables domestic transfers with complete bank details only',()=>{
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/transfer-config.js'),'utf8'),context);
  assert.equal(context.window.LAS_NANAS_TRANSFER.enabled,true);
  assert.equal(api.configured(context.window.LAS_NANAS_TRANSFER),true);
  for (const currency of ['CLP','USD','EUR']) {
    assert.equal(api.canSend(context.window.LAS_NANAS_TRANSFER,'domestic',currency),true);
    assert.equal(api.canSend(context.window.LAS_NANAS_TRANSFER,'international',currency),false);
  }
  assert.equal(context.window.LAS_NANAS_TRANSFER.bank.referenceInstructions,
    'Escribe el código de tu solicitud en el comentario o referencia de la transferencia');
});

async function adminPanel({received=true,enabled=true,revoke=false}={}) {
  const nodes=new Map(), calls=[];
  function node(){return {children:[],events:{},dataset:{},disabled:false,hidden:false,textContent:'',
    elements:{reference:{value:'BANK-001'},bankVerified:{checked:false}},
    classList:{toggle(){}},setAttribute(){},removeAttribute(){},scrollIntoView(){},reset(){},
    addEventListener(name,fn){this.events[name]=fn;},
    append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},
    querySelector(key){return select(key);},reportValidity(){return true;},showModal(){},close(){}};}
  function select(key){if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);}
  const viewNames=['applications','clarifications','payments','documents','activities','agendas'];
  const views=viewNames.map(name=>{const view=select(`[data-admin-view="${name}"]`);view.dataset.adminView=name;return view;});
  const viewButtons=viewNames.map(name=>{const button=select(`[data-admin-view-button="${name}"]`);button.dataset.adminViewButton=name;return button;});
  const categories=['all','pending','process','rejected','active','withdrawn'].map(name=>{
    const button=select(`[data-category="${name}"]`);button.dataset.category=name;return button;
  });
  const app={application_id:'10000000-0000-0000-0000-000000000001',application_status:'approved',first_name:'Prueba',last_name:'Uno',plan_id:'standard',billing:'monthly',application_created_at:'2026-09-23T00:00:00Z',currency:'CLP',quoted_amount:10000};
  let accessCalls=0,confirmed=false;
  const client={auth:{getUser:async()=>({data:{user:{id:'admin'}}})},from(name){
    assert.ok(['volunteer_profiles','application_messages','admin_notes'].includes(name),`Unexpected table ${name}`);
    const query={select(){return query;},eq(){return query;},is(){return query;},async order(){return {data:[]};}};
    return query;
  },async rpc(name){
    calls.push(name);
    if(name==='admin_list_membership_applications_v2')return {data:[app]};
    if(name==='can_read_agenda')return {data:true};
    if(name==='admin_get_membership_application'){
      accessCalls++;return revoke&&accessCalls>1?{error:{message:'admin_access_required'}}:{data:[app]};
    }
    if(name==='admin_get_application_membership')return {data:[{membership_active:confirmed,payment_status:confirmed?'confirmed':null}]};
    if(name==='admin_confirm_transfer'){confirmed=true;return {data:[{payment_status:'confirmed',membership_active:true}]};}
    if(name==='admin_list_application_documents')return {data:[]};
    throw new Error('Unexpected RPC '+name);
  }};
  const transfers={configured:()=>enabled,createService:()=>({
    receipt:async()=>received?{id:'receipt-a',status:'received'}:null,download:async()=>{}
  })};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/coordinacion-voluntariado.js'),'utf8'),{
    window:{LasNanasSupabase:{client},LasNanasTransfers:transfers,location:{replace(){},assign(){}}},
    document:{querySelector:select,querySelectorAll(key){
      if(key==='[data-admin-view]')return views;
      if(key==='[data-admin-view-button]')return viewButtons;
      if(key==='[data-category]')return categories;
      throw new Error(`Unexpected selector ${key}`);
    },createElement:node},Intl,Date
  });
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  await flush();
  assert.equal(select('[data-admin-layout]').hidden,false,'admin panel should open');
  viewButtons[2].events.click();
  assert.equal(views[2].hidden,false,'payment view should be accessible');
  select('[data-payments-list]').children[0].children[1].events.click();
  await flush();
  return {select,calls,flush};
}
test('admin must download receipt and acknowledge bank verification before confirming',async()=>{
  const p=await adminPanel();
  assert.equal(p.select('[data-detail-field="application_code"]').textContent,'10000000-0000-0000-0000-000000000001');
  assert.equal(p.select('[data-confirm-transfer]').disabled,true);
  await p.select('[data-admin-receipt-download]').events.click();
  assert.equal(p.select('[data-confirm-transfer]').disabled,false);
  p.select('[data-confirm-transfer]').events.click();
  assert.equal(p.select('[data-transfer-summary="application_code"]').textContent,
    p.select('[data-detail-field="application_code"]').textContent);
  const form=p.select('[data-transfer-form]');
  await form.events.submit({preventDefault(){}});
  assert.equal(p.calls.includes('admin_confirm_transfer'),false);
  form.elements.bankVerified.checked=true;
  await form.events.submit({preventDefault(){}});
  assert.equal(p.calls.filter(x=>x==='admin_confirm_transfer').length,1);
});
test('revoked admin is rejected before payment confirmation',async()=>{
  const p=await adminPanel({revoke:true});
  await p.select('[data-admin-receipt-download]').events.click();
  const form=p.select('[data-transfer-form]');form.elements.bankVerified.checked=true;
  await form.events.submit({preventDefault(){}});
  assert.equal(p.calls.includes('admin_confirm_transfer'),false);
});
for(const options of [{received:false},{enabled:false}])test('admin confirmation stays blocked '+JSON.stringify(options),async()=>{
  const p=await adminPanel(options);
  await p.select('[data-admin-receipt-download]').events.click();
  assert.equal(p.select('[data-confirm-transfer]').disabled,true);
  const form=p.select('[data-transfer-form]');form.elements.bankVerified.checked=true;
  await form.events.submit({preventDefault(){}});
  assert.equal(p.calls.includes('admin_confirm_transfer'),false);
});
