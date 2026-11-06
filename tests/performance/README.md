# Pruebas de rendimiento con k6

`k6-smoke.js` hace consultas de solo lectura a la API: salud, servicios, barberos, configuración, reseñas y, si existen datos, disponibilidad. No crea reservas ni modifica datos.

## Requisitos

1. API iniciada (`npm run dev` desde la raíz del proyecto).
2. Base de prueba o una instalación local segura, con al menos un servicio y un barbero activos.
3. [k6 instalado](https://grafana.com/docs/k6/latest/set-up/install-k6/).

## Ejecución

```powershell
k6 run tests/performance/k6-smoke.js

# Ajustar número de usuarios virtuales e iteraciones, sin superar la capacidad local.
k6 run -e BASE_URL=http://localhost:3002 -e VUS=3 -e ITERATIONS=5 tests/performance/k6-smoke.js
```

## Interpretación

El script falla si hay más de 1 % de errores HTTP, menos de 99 % de comprobaciones satisfactorias o si el percentil 95 supera 700 ms. Estos valores son criterios iniciales para desarrollo local; documentar el hardware, estado de la base y la versión evaluada al comparar resultados.

No usar este archivo para medir reservas simultáneas sin diseñar datos desechables y una limpieza posterior. La concurrencia de creación de citas se valida funcionalmente mediante el caso `F8-AGE-02` del plan de pruebas.

