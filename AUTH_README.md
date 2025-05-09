# Guía de Autenticación para WhatsApp Property Bot

Este documento explica cómo autenticarse y usar la API del WhatsApp Property Bot.

## Credenciales por defecto

Se ha creado un usuario administrador por defecto con las siguientes credenciales:

```
Usuario: admin
Contraseña: admin123
```

⚠️ **Es altamente recomendable cambiar la contraseña después del primer inicio de sesión** ⚠️

## Flujo de autenticación

1. **Iniciar sesión para obtener un token JWT:**

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  http://localhost:3000/api/auth/login
```

2. **Usar el token para acceder a recursos protegidos:**

```bash
curl -X GET \
  -H "Authorization: Bearer TU_TOKEN_JWT" \
  http://localhost:3000/api/users
```

## Endpoints principales

### Públicos (no requieren autenticación)

- `GET /status` - Verifica si el servidor está funcionando
- `POST /api/auth/login` - Inicia sesión y obtiene un token JWT

### Protegidos (requieren autenticación)

- `GET /api/auth/verify` - Verifica si un token JWT es válido
- `GET /api/users` - Lista todos los usuarios
- `GET /api/google-sheets` - Lista todas las hojas de Google
- `POST /api/google-sheets` - Crea una nueva conexión a una hoja de Google

## Resolución de problemas

### Error 401 (No autorizado)

Si recibes un error 401 con el mensaje "Token no proporcionado", significa que estás intentando acceder a un recurso protegido sin proporcionar un token de autenticación o el token proporcionado no es válido.

Solución:
1. Asegúrate de incluir el encabezado `Authorization: Bearer TU_TOKEN_JWT` en tus solicitudes.
2. Verifica que el token no haya expirado (por defecto, expira después de 7 días).
3. Inicia sesión nuevamente para obtener un nuevo token.

### Error 403 (Prohibido)

Si recibes un error 403, significa que tu usuario no tiene los permisos necesarios para acceder al recurso solicitado.

Solución:
1. Usa una cuenta con los permisos adecuados.
2. Contacta al administrador del sistema para que te asigne los permisos necesarios.

## Ejemplo de flujo completo

1. **Iniciar sesión:**

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  http://localhost:3000/api/auth/login
```

Respuesta:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "username": "admin",
    "email": "admin@example.com",
    "fullName": "Administrador",
    "role": "admin",
    "permissions": ["manage_users", "manage_sheets", "view_queries", "respond_queries", "access_bot", "view_dashboard"],
    "lastLogin": "2023-08-15T10:30:00.000Z"
  }
}
```

2. **Acceder a un recurso protegido:**

```bash
curl -X GET \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  http://localhost:3000/api/google-sheets
```

Respuesta:
```json
[
  {
    "id": 1,
    "sheet_id": "1H8wonTkMb3WNANCiASqqTCL7_o-ks2py_RlUPGy6AfM",
    "name": "Propiedades",
    "description": "Listado de propiedades inmobiliarias",
    "range": "A:Z",
    "is_active": 1,
    "created_by": 1,
    "created_at": "2023-08-15T10:30:00.000Z",
    "updated_at": "2023-08-15T10:30:00.000Z",
    "creator_username": "admin"
  }
]
``` 