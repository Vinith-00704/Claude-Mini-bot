// Small JSON helpers over the runtime's replies. Replies are read as nested
// dictionaries; a missing key reads as the default, so the overlay keeps
// working if the runtime adds or omits fields.

using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace MiniBot
{
    public static class Json
    {
        static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        public static Dictionary<string, object> Parse(string text)
        {
            object parsed = Serializer.DeserializeObject(text);
            return parsed as Dictionary<string, object> ?? new Dictionary<string, object>();
        }

        public static string Write(object value)
        {
            return Serializer.Serialize(value);
        }

        static object Raw(object parent, string key)
        {
            var d = parent as Dictionary<string, object>;
            object v;
            return d != null && d.TryGetValue(key, out v) ? v : null;
        }

        public static Dictionary<string, object> Obj(object parent, string key)
        {
            return Raw(parent, key) as Dictionary<string, object> ?? new Dictionary<string, object>();
        }

        public static object[] Arr(object parent, string key)
        {
            return Raw(parent, key) as object[] ?? new object[0];
        }

        public static string Str(object parent, string key, string fallback = "")
        {
            var v = Raw(parent, key);
            return v is string ? (string)v : fallback;
        }

        public static int Int(object parent, string key, int fallback = 0)
        {
            var v = Raw(parent, key);
            if (v is int || v is long || v is double || v is decimal) return Convert.ToInt32(v);
            return fallback;
        }

        public static bool Bool(object parent, string key, bool fallback = false)
        {
            var v = Raw(parent, key);
            return v is bool ? (bool)v : fallback;
        }

        public static bool Has(object parent, string key)
        {
            return Raw(parent, key) != null;
        }
    }
}
