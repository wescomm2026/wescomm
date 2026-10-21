const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {readSnapshot,buildPlan}=require('./plan-production-transaction-reset.cjs');
const requireBackend=createRequire(path.resolve('backend/package.json'));
const {PrismaClient}=requireBackend('@prisma/client');

async function restoreAndClear(tx,expectedHash,backupRunId){
  // Lock writes before rebuilding the approved snapshot. Reads remain available.
  await tx.$executeRawUnsafe(`LOCK TABLE products,product_skus,product_variants,inventory_batches,inventory_movements,reservations,reservation_items,reservation_idempotency_keys,reservation_schedule_changes,reservation_bulk_actions,receipts,walk_in_sales,walk_in_sale_items,walk_in_sale_cost_allocations,payments,online_payments,online_payment_attempts,paymongo_webhook_events,order_item_cost_allocations,treasury_official_receipts IN EXCLUSIVE MODE`);
  const data=await readSnapshot(tx);
  const plan=buildPlan(data,'pffbftlyrovuprrebdsy');
  assert.equal(plan.snapshotHash,expectedHash,'Data changed since approval; a new dry run is required.');
  assert.equal(plan.warnings.length,0,'Stock restoration warnings require review.');
  assert.equal(plan.counts.online_payments+plan.counts.online_payment_attempts+plan.counts.paymongo_webhook_events,0,'Online payment records need separate review.');
  assert.equal(plan.counts.receipts,plan.transactionIds.receipts.length,'Reservation/legacy receipts need separate review.');
  assert.ok(plan.counts.walk_in_sales+plan.counts.reservations>0,'No transactions remain; refusing a repeated reset.');
  assert.equal(await tx.studentOffense.count({where:{reservationId:{in:plan.transactionIds.reservations}}}),0,'Reservation penalties require separate review.');
  const prices=await tx.product.findMany({select:{id:true,price:true,oldPrice:true},orderBy:{id:'asc'}});
  const costs=await tx.inventoryBatch.findMany({select:{id:true,unitCost:true,costVerified:true,quantityReceived:true},orderBy:{id:'asc'}});
  for(const p of plan.stockRestoration.products){
    const current=await tx.product.findUniqueOrThrow({where:{id:p.id},select:{status:true,lowStockThreshold:true}});
    const status=p.after<=0?'OUT_OF_STOCK':p.after<=current.lowStockThreshold?'RESTOCK_SOON':current.status==='ON_SALE'?'ON_SALE':'IN_STOCK';
    assert.equal((await tx.product.updateMany({where:{id:p.id,stock:p.before},data:{stock:p.after,status}})).count,1);
  }
  for(const s of plan.stockRestoration.skus)assert.equal((await tx.productSku.updateMany({where:{id:s.id,stock:s.before},data:{stock:s.after}})).count,1);
  for(const v of plan.stockRestoration.variants)assert.equal((await tx.productVariant.updateMany({where:{id:v.id,stock:v.before},data:{stock:v.after}})).count,1);
  for(const b of plan.stockRestoration.batches)assert.equal((await tx.inventoryBatch.updateMany({where:{id:b.id,quantityRemaining:b.before},data:{quantityRemaining:b.after}})).count,1);
  const ids=[...plan.transactionIds.sales,...plan.transactionIds.receipts,...plan.transactionIds.reservations];
  const deleted={};
  for(const [label,model] of [['order_item_cost_allocations','orderItemCostAllocation'],['walk_in_sale_cost_allocations','walkInSaleCostAllocation'],['walk_in_sale_items','walkInSaleItem'],['walk_in_sales','walkInSale'],['payments','payment'],['receipts','receipt'],['paymongo_webhook_events','paymongoWebhookEvent'],['online_payment_attempts','onlinePaymentAttempt'],['online_payments','onlinePayment'],['reservation_schedule_changes','reservationScheduleChange'],['reservation_idempotency_keys','reservationIdempotencyKey'],['reservation_bulk_actions','reservationBulkAction'],['reservation_items','reservationItem'],['reservations','reservation']]){
    const r=await tx[model].deleteMany();deleted[label]=r.count;
  }
  deleted.inventory_transaction_movements=(await tx.inventoryMovement.deleteMany({where:{id:{in:plan.transactionIds.movements}}})).count;
  await tx.outboxEvent.deleteMany({where:{entityId:{in:ids}}});
  await tx.realtimeEvent.deleteMany({where:{entityId:{in:ids}}});
  await tx.notification.deleteMany({where:{OR:[{actionUrl:{contains:'/reservations'}},{actionUrl:{contains:'/receipts'}},{actionUrl:{contains:'/walk-in-sales'}},{actionUrl:{contains:'/receipt-verification'}}]}});
  const adjustments=[...plan.stockRestoration.products.map(p=>({productId:p.id,previousStock:p.before,newStock:p.after,quantity:p.restore})),...plan.stockRestoration.skus.map(s=>({productId:s.productId,skuId:s.id,previousStock:s.before,newStock:s.after,quantity:s.restore})),...plan.stockRestoration.variants.map(v=>({productId:v.productId,variantId:v.id,previousStock:v.before,newStock:v.after,quantity:v.restore}))];
  if(adjustments.length)await tx.inventoryMovement.createMany({data:adjustments.map(a=>({...a,type:'ADJUSTMENT',notes:'Production transaction reset: returned only outstanding transaction deductions.'}))});
  assert.equal(await tx.profile.count(),plan.counts.profiles);
  assert.equal(await tx.product.count(),plan.counts.products);
  assert.equal(await tx.productSku.count(),plan.counts.product_skus);
  assert.equal(await tx.productVariant.count(),plan.counts.product_variants);
  assert.equal(await tx.inventoryBatch.count(),plan.counts.inventory_batches);
  assert.deepEqual(await tx.product.findMany({select:{id:true,price:true,oldPrice:true},orderBy:{id:'asc'}}),prices);
  assert.deepEqual(await tx.inventoryBatch.findMany({select:{id:true,unitCost:true,costVerified:true,quantityReceived:true},orderBy:{id:'asc'}}),costs);
  for(const model of ['walkInSale','receipt','reservation','payment','onlinePayment','walkInSaleCostAllocation','orderItemCostAllocation'])assert.equal(await tx[model].count(),0);
  const after=buildPlan(await readSnapshot(tx),'pffbftlyrovuprrebdsy');
  assert.equal(after.stockRestoration.products.length+after.stockRestoration.skus.length+after.stockRestoration.variants.length+after.stockRestoration.batches.length,0,'A transaction deduction remains after reset.');
  await tx.auditLog.create({data:{action:'PRODUCTION_TRANSACTIONS_RESET',entityType:'maintenance',summary:'Owner-approved transaction reset with stock restoration.',metadata:{initiatedBy:'wescomm2026',backupRunId,approvedSnapshot:expectedHash,deleted,stockRestoration:plan.stockRestoration}}});
  return {status:'APPLIED',backupRunId,approvedSnapshot:expectedHash,deleted,stockRestoration:plan.stockRestoration,preserved:{profiles:plan.counts.profiles,products:plan.counts.products,productSkus:plan.counts.product_skus,productVariants:plan.counts.product_variants,inventoryBatches:plan.counts.inventory_batches,pricesUnchanged:true,costsUnchanged:true},afterCounts:after.counts};
}
async function main(){
  const expected=process.env.EXPECTED_SUPABASE_PROJECT_REF;
  assert.equal(expected,'pffbftlyrovuprrebdsy');
  assert.equal(process.env.GITHUB_ACTOR,'wescomm2026','Only the approved owner may start this maintenance operation.');
  assert.equal(process.env.RESET_CONFIRMATION,'RESET_TRANSACTIONS_RESTORE_STOCK');
  const target=new URL(process.env.DATABASE_URL);
  const ref=target.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1]??decodeURIComponent(target.username).match(/\.([a-z0-9]+)$/)?.[1];
  assert.equal(ref,expected);assert.equal(target.port||'5432','5432');assert.ok(['require','verify-ca','verify-full'].includes(target.searchParams.get('sslmode')));
  assert.match(process.env.APPROVED_SNAPSHOT_HASH??'',/^[a-f0-9]{64}$/);
  const db=new PrismaClient({log:[]});
  try{const result=await db.$transaction(tx=>restoreAndClear(tx,process.env.APPROVED_SNAPSHOT_HASH,process.env.GITHUB_RUN_ID),{timeout:90000,maxWait:15000,isolationLevel:'Serializable'});fs.mkdirSync('reset-result',{recursive:true});fs.writeFileSync('reset-result/production-transaction-reset-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,deleted:result.deleted,preserved:result.preserved}));}
  finally{await db.$disconnect();}
}
module.exports={restoreAndClear};
if(require.main===module)main().catch(error=>{console.error('Reset stopped: '+String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted URL]'));process.exitCode=1;});
