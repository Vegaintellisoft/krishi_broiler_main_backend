// uniqueKeys.js
const uniqueKeys = {
    broiler_stock_location: ["mandt", "werks", "lifnr"],
    line_master: ["mandt", "werks", "zzline"],
    shed_capacity_master: ["mandt", "zzfarmSt"],
    hetchery_machine_master: ["mandt", "zzbroMacN"],
    rejection_reason_master: ["mandt", "rsType", "rsCode"],
    broiler_mortality_reason: ["mandt", "rsCode"],
    standard_body_master: ["mandt", "zzAge"],
    mortality_incentive: ["mandt", "zzfrmoFcr", "zztoFcr"],


    mortality_deduction: ["mandt", "zzfrmoFcr", "zztoFcr"],
    medicine_deduction_maintain: ["mandt", "wrbtr", "wrbtrP"],
    earned_rc_master: ["mandt", "zerc"],
    vehicle_type_cost: ["mandt", "zvehStyp"],
    fcr_grade_master: ["mandt", "zgrade"],
    earned_rc_master1: ["mandt", "zerc"],
    broiler_sales_emp_default: ["mandt", "werks", "zzdispBy", "zzorderBy"],
    broiler_sales_rate: ["mandt", "werks", "allPer"],
    egg_code_list: ["mandt", "matnr"],
    fcr_grade_master1: ["mandt", "zerc"],
    broiler_shed_incentive_details: ["mandt", "werks", "begda", "endda"],
    mortality_incentive_plant: ["mandt", "werks", "zzfrmoFcr", "zztoFcr"],
    mortality_deduction_plant: ["mandt", "werks", "zzfrmoFcr", "zztoFcr"],
    mortality_deduction_maintain_plant: ["mandt", "werks", "wrbtr", "wrbtrP"],
    earned_rc_master2: ["mandt", "werks", "zerc"],
    earned_rc_master3: ["mandt", "werks", "zerc"]
};

module.exports = uniqueKeys;
