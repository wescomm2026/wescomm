const assert=require('node:assert/strict');
const {test,after,beforeEach}=require('node:test');
const {randomUUID}=require('node:crypto');
const {createRequire}=require('node:module');
const path=require('node:path');
const requireBackend=createRequire(path.resolve('backend/package.json'));
const {PrismaClient}=requireBackend('@prisma/client');
const {readSnapshot,buildPlan}=require('./plan-production-transaction-reset.cjs');
const {restoreAndClear}=require('./apply-production-transaction-reset.cjs');
const target=new URL(process.env.DATABASE_URL);
assert.ok(['127.0.0.1','localhost'].includes(target.hostname));
assert.equal(target.pathname,'/wescomm_reset_test');
const db=new PrismaClient({log:[]});
beforeEach(async()=>{await db.$executeRawUnsafe('TRUNCATE profiles,categories,products,receipts,reservations,inventory_batches,inventory_movements,audit_logs CASCADE');});
after(async()=>db.$disconnect());
async function fixture(){
 const actor=await db.profile.create({data:{id:randomUUID(),email:'reset-test@example.invalid',fullName:'Reset test admin',role:'ADMIN'}});
 const category=await db.category.create({data:{name:'Reset test',slug:'reset-test'}});
 const product=await db.product.create({data:{categoryId:category.id,name:'Reset test shirt',price:350,stock:4,status:'IN_STOCK',saleMode:'OPTIONS',skuInventoryEnabled:true}});
 const skus=[],batches=[],items=[];
 for(const [index,size] of ['S','M'].entries()){
  const variant=await db.productVariant.create({data:{productId:product.id,optionName:'Size',optionValue:size,stock:2}});
  const sku=await db.productSku.create({data:{productId:product.id,code:size,stock:2,optionValues:{create:{variantId:variant.id}}}});skus.push(sku);
  const batch=await db.inventoryBatch.create({data:{productId:product.id,skuId:sku.id,batchCode:size,quantityReceived:3,quantityRemaining:2,unitCost:150,costVerified:true,receivedAt:new Date('2026-09-30T00:00:00Z'),createdById:actor.id}});batches.push(batch);
  const receipt=await db.receipt.create({data:{receiptCode:'RESET-'+size,verificationHash:randomUUID(),status:'VERIFIED',totalAmount:350,issuedById:actor.id}});
  const sale=await db.walkInSale.create({data:{receiptId:receipt.id,buyerNameSnapshot:'Synthetic reset buyer',cashierNameSnapshot:'Reset test admin',cashierId:actor.id,clientSaleId:randomUUID(),requestFingerprint:'f'.repeat(64),cashTendered:500,changeDue:150}});
  const item=await db.walkInSaleItem.create({data:{saleId:sale.id,receiptId:receipt.id,productId:product.id,skuId:sku.id,productNameSnapshot:product.name,quantity:1,unitPrice:350,subtotal:350}});items.push(item);
  await db.walkInSaleCostAllocation.create({data:{walkInSaleItemId:item.id,inventoryBatchId:batch.id,quantity:1,unitCost:150}});
  await db.inventoryMovement.createMany({data:[{productId:product.id,type:'SALE',quantity:1,previousStock:6-index,newStock:5-index,notes:'Walk-in sale RESET-'+size},{productId:product.id,skuId:sku.id,type:'SALE',quantity:1,previousStock:3,newStock:2,notes:'Walk-in sale RESET-'+size}]});
 }
 // A cancelled hold is already returned and must contribute zero restoration.
 const reservation=await db.reservation.create({data:{studentId:actor.id,referenceCode:'RESET-CANCEL',status:'CANCELLED',totalAmount:350,items:{create:{productId:product.id,skuId:skus[0].id,productNameSnapshot:product.name,quantity:1,unitPrice:350,subtotal:350}}}});
 await db.inventoryMovement.createMany({data:[{productId:product.id,type:'RESERVATION_HOLD',quantity:1,previousStock:6,newStock:5,notes:'Reservation RESET-CANCEL'},{productId:product.id,type:'RESERVATION_CANCEL',quantity:1,previousStock:5,newStock:6,notes:'Reservation RESET-CANCEL cancelled'}]});
 return {actor,product,skus,batches,items,reservation};
}
const plan=async()=>buildPlan(await readSnapshot(db),'pffbftlyrovuprrebdsy');
const reset=hash=>db.$transaction(tx=>restoreAndClear(tx,hash,'local-test-backup'),{timeout:30000});
test('restores product, sizes, options and FIFO cost quantities; clears transactions and preserves accounts/prices/costs',async()=>{
 const f=await fixture();const p=await plan();assert.equal(p.warnings.length,0);assert.equal(p.stockRestoration.products[0].restore,2);
 const r=await reset(p.snapshotHash);assert.equal(r.preserved.pricesUnchanged,true);assert.equal(r.preserved.costsUnchanged,true);
 assert.equal((await db.product.findUniqueOrThrow({where:{id:f.product.id}})).stock,6);
 assert.deepEqual((await db.productSku.findMany()).map(s=>s.stock),[3,3]);assert.deepEqual((await db.productVariant.findMany()).map(v=>v.stock),[3,3]);
 assert.deepEqual((await db.inventoryBatch.findMany()).map(b=>b.quantityRemaining),[3,3]);assert.equal(await db.profile.count(),1);assert.equal(await db.receipt.count(),0);assert.equal(await db.reservation.count(),0);
 await assert.rejects(reset(p.snapshotHash));assert.equal((await db.product.findUniqueOrThrow({where:{id:f.product.id}})).stock,6);
});
test('a changed or unapproved snapshot rejects the entire reset',async()=>{
 const f=await fixture();await assert.rejects(reset('0'.repeat(64)),/Data changed since approval/);
 assert.equal(await db.receipt.count(),2);assert.equal((await db.product.findUniqueOrThrow({where:{id:f.product.id}})).stock,4);
});
test('PostgreSQL rolls back restored stock and batch balances when a later delete fails',async()=>{
 const f=await fixture();const p=await plan();
 await db.$executeRawUnsafe("CREATE FUNCTION reset_test_refuse_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'reset rollback probe'; END $$");
 await db.$executeRawUnsafe('CREATE TRIGGER reset_test_failure BEFORE DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION reset_test_refuse_delete()');
 try{await assert.rejects(reset(p.snapshotHash));assert.equal((await db.product.findUniqueOrThrow({where:{id:f.product.id}})).stock,4);assert.deepEqual((await db.inventoryBatch.findMany()).map(b=>b.quantityRemaining),[2,2]);assert.equal(await db.walkInSale.count(),2);assert.equal(await db.receipt.count(),2);}
 finally{await db.$executeRawUnsafe('DROP TRIGGER reset_test_failure ON receipts');await db.$executeRawUnsafe('DROP FUNCTION reset_test_refuse_delete()');}
});
test('an already-voided sale is not returned twice',async()=>{
 const f=await fixture();await db.product.update({where:{id:f.product.id},data:{stock:5}});await db.productSku.update({where:{id:f.skus[0].id},data:{stock:3}});await db.productVariant.updateMany({where:{productId:f.product.id,optionValue:'S'},data:{stock:3}});await db.inventoryBatch.update({where:{id:f.batches[0].id},data:{quantityRemaining:3}});await db.walkInSaleCostAllocation.updateMany({where:{walkInSaleItemId:f.items[0].id},data:{reversedAt:new Date()}});
 await db.inventoryMovement.createMany({data:[{productId:f.product.id,type:'ADJUSTMENT',quantity:1,previousStock:4,newStock:5,notes:'Walk-in sale RESET-S voided — test'},{productId:f.product.id,skuId:f.skus[0].id,type:'ADJUSTMENT',quantity:1,previousStock:2,newStock:3,notes:'Walk-in sale RESET-S voided — test'}]});
 const p=await plan();assert.equal(p.stockRestoration.products[0].restore,1);await reset(p.snapshotHash);assert.equal((await db.product.findUniqueOrThrow({where:{id:f.product.id}})).stock,6);assert.deepEqual((await db.productSku.findMany()).map(s=>s.stock),[3,3]);
});
test('a later manual stock count blocks automatic restoration',async()=>{
 const f=await fixture();await db.inventoryMovement.create({data:{productId:f.product.id,type:'ADJUSTMENT',quantity:3,previousStock:4,newStock:7,notes:'Physical recount',createdAt:new Date(Date.now()+1000)}});
 const p=await plan();assert.ok(p.warnings.length);await assert.rejects(reset(p.snapshotHash),/warnings require review/);assert.equal(await db.walkInSale.count(),2);
});
