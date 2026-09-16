import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { Route, routesTableName } from "../tables/routes.table";

export class RouteModel extends BasicDataModel(Route, routesTableName) {}
