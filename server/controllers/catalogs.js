import { Department, Designation, Employee } from '../models/index.js';
import { AppError, ok, pick } from '../utils/http.js';
import { transaction, lockSettings, audit } from '../services/core.js';
const modelFor = (req) => (req.baseUrl.endsWith('departments') ? Department : Designation);
export async function list(req, res) {
  const Model = modelFor(req);
  const items = await Model.find()
    .sort({ name: 1 })
    .populate(Model === Designation ? 'department' : []);
  ok(res, items);
}
export async function save(req, res) {
  const Model = modelFor(req);
  const item = await transaction(async (session) => {
    await lockSettings(session);
    const data = pick(
      req.body,
      Model === Department ? ['name', 'description'] : ['name', 'department'],
    );
    if (
      Model === Designation &&
      !(await Department.exists({ _id: data.department }).session(session))
    )
      throw new AppError(400, 'Department not found');
    let item;
    if (req.params.id) {
      item = await Model.findById(req.params.id).session(session);
      if (!item) throw new AppError(404, 'Record not found');
      if (
        Model === Designation &&
        String(item.department) !== data.department &&
        (await Employee.exists({ designation: item._id }).session(session))
      )
        throw new AppError(
          409,
          'This job title is used by employees, so its department cannot change.',
        );
      Object.assign(item, data);
      await item.save({ session });
    } else {
      [item] = await Model.create([data], { session });
    }
    await audit(
      req,
      `${Model.modelName.toLowerCase()}.${req.params.id ? 'updated' : 'created'}`,
      Model.modelName,
      item._id,
      { name: item.name },
      session,
    );
    return item;
  });
  ok(res, item, 'Saved', req.params.id ? 200 : 201);
}
export async function remove(req, res) {
  const Model = modelFor(req);
  await transaction(async (session) => {
    await lockSettings(session);
    const key = Model === Department ? 'department' : 'designation';
    if (
      (await Employee.exists({ [key]: req.params.id }).session(session)) ||
      (Model === Department &&
        (await Designation.exists({ department: req.params.id }).session(session)))
    )
      throw new AppError(
        409,
        'This item is used by employees or job titles and cannot be deleted.',
      );
    const result = await Model.findByIdAndDelete(req.params.id, { session });
    if (!result) throw new AppError(404, 'Record not found');
    await audit(
      req,
      `${key}.deleted`,
      Model.modelName,
      req.params.id,
      { name: result.name },
      session,
    );
  });
  ok(res, null, 'Deleted');
}
