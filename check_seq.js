require('dotenv').config();
const { query } = require('./config/db');

async function check() {
    try {
        const r = await query(
            "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='broiler' AND sequence_name='bill_of_supply_doc_seq'"
        );
        console.log('Sequence exists?', r);

        if (r && r.length > 0) {
            const r2 = await query("SELECT nextval('broiler.bill_of_supply_doc_seq') AS seq");
            console.log('Next val:', r2);
        } else {
            console.log('SEQUENCE DOES NOT EXIST - needs to be created');
        }
    } catch (e) {
        console.error('ERROR:', e.message);
    }
    process.exit(0);
}

check();
