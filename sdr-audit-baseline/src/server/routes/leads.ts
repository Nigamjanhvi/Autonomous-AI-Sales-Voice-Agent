import { Router } from "express";
import { createLeadRecord, deleteLeadRecord, listLeadRecords, readLeadRecord, updateLeadRecord } from "../controllers/leads.js";

export const leadsRouter = Router();

leadsRouter.route("/leads")
  .get(listLeadRecords)
  .post(createLeadRecord);

leadsRouter.route("/leads/:leadId")
  .get(readLeadRecord)
  .patch(updateLeadRecord)
  .delete(deleteLeadRecord);
