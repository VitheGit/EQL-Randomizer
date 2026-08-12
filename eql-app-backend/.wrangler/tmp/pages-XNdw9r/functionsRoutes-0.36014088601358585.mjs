import { onRequestPost as __api_admin_clear_js_onRequestPost } from "C:\\Users\\Owner\\Downloads\\eql-app-backend\\eql-app-backend\\functions\\api\\admin\\clear.js"
import { onRequestPost as __api_auth_login_js_onRequestPost } from "C:\\Users\\Owner\\Downloads\\eql-app-backend\\eql-app-backend\\functions\\api\\auth\\login.js"
import { onRequestPost as __api_auth_logout_js_onRequestPost } from "C:\\Users\\Owner\\Downloads\\eql-app-backend\\eql-app-backend\\functions\\api\\auth\\logout.js"
import { onRequestPost as __api_auth_register_js_onRequestPost } from "C:\\Users\\Owner\\Downloads\\eql-app-backend\\eql-app-backend\\functions\\api\\auth\\register.js"
import { onRequestGet as __api_kv_js_onRequestGet } from "C:\\Users\\Owner\\Downloads\\eql-app-backend\\eql-app-backend\\functions\\api\\kv.js"
import { onRequestGet as __api_me_js_onRequestGet } from "C:\\Users\\Owner\\Downloads\\eql-app-backend\\eql-app-backend\\functions\\api\\me.js"
import { onRequestPost as __api_resolve_js_onRequestPost } from "C:\\Users\\Owner\\Downloads\\eql-app-backend\\eql-app-backend\\functions\\api\\resolve.js"
import { onRequestPost as __api_roll_js_onRequestPost } from "C:\\Users\\Owner\\Downloads\\eql-app-backend\\eql-app-backend\\functions\\api\\roll.js"
import { onRequest as __api__middleware_js_onRequest } from "C:\\Users\\Owner\\Downloads\\eql-app-backend\\eql-app-backend\\functions\\api\\_middleware.js"

export const routes = [
    {
      routePath: "/api/admin/clear",
      mountPath: "/api/admin",
      method: "POST",
      middlewares: [],
      modules: [__api_admin_clear_js_onRequestPost],
    },
  {
      routePath: "/api/auth/login",
      mountPath: "/api/auth",
      method: "POST",
      middlewares: [],
      modules: [__api_auth_login_js_onRequestPost],
    },
  {
      routePath: "/api/auth/logout",
      mountPath: "/api/auth",
      method: "POST",
      middlewares: [],
      modules: [__api_auth_logout_js_onRequestPost],
    },
  {
      routePath: "/api/auth/register",
      mountPath: "/api/auth",
      method: "POST",
      middlewares: [],
      modules: [__api_auth_register_js_onRequestPost],
    },
  {
      routePath: "/api/kv",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_kv_js_onRequestGet],
    },
  {
      routePath: "/api/me",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_me_js_onRequestGet],
    },
  {
      routePath: "/api/resolve",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_resolve_js_onRequestPost],
    },
  {
      routePath: "/api/roll",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_roll_js_onRequestPost],
    },
  {
      routePath: "/api",
      mountPath: "/api",
      method: "",
      middlewares: [__api__middleware_js_onRequest],
      modules: [],
    },
  ]