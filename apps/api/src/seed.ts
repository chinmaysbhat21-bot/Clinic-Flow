import { openDb,seed } from './db.js';
const db=openDb(process.env.DATABASE_PATH??'data/clinic.db');seed(db,process.env.ADMIN_PASSWORD);db.close();console.log('Fictional clinics seeded.');
