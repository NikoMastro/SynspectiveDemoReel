package domain

import "math"

// WGS84 ellipsoid and Earth rotation. These are the same constants notebook 03
// uses, so the Go results can be differenced against the Python reference.
const (
	EarthRadiusM      = 6378137.0         // WGS84 semi-major axis
	EarthFlattening   = 1 / 298.257223563 // WGS84 flattening
	EarthRotationRate = 7.292115e-5       // rad/s
	EarthGM           = 3.986004418e14    // gravitational parameter, m^3/s^2
)

// eccentricitySquared is e^2 = f(2-f) for the WGS84 ellipsoid.
var eccentricitySquared = EarthFlattening * (2 - EarthFlattening)

// Geodetic is a position on or above the WGS84 ellipsoid.
type Geodetic struct {
	LatDeg    float64
	LonDeg    float64
	AltitudeM float64
}

// GeodeticToECEF converts latitude, longitude and height above the ellipsoid
// into Earth-Centred Earth-Fixed metres.
func GeodeticToECEF(g Geodetic) Vec3 {
	lat := g.LatDeg * math.Pi / 180
	lon := g.LonDeg * math.Pi / 180
	sinLat, cosLat := math.Sincos(lat)
	sinLon, cosLon := math.Sincos(lon)

	// N is the radius of curvature in the prime vertical.
	n := EarthRadiusM / math.Sqrt(1-eccentricitySquared*sinLat*sinLat)
	return Vec3{
		X: (n + g.AltitudeM) * cosLat * cosLon,
		Y: (n + g.AltitudeM) * cosLat * sinLon,
		Z: (n*(1-eccentricitySquared) + g.AltitudeM) * sinLat,
	}
}

// ECEFToGeodetic is the inverse. There is no closed form for geodetic latitude
// on an ellipsoid, so this is the classic fixed-point iteration: start from the
// spherical answer and refine. Notebook 03 uses six passes; five is already
// below a micrometre for near-Earth orbits, and six costs nothing.
func ECEFToGeodetic(r Vec3) Geodetic {
	lon := math.Atan2(r.Y, r.X)
	p := math.Hypot(r.X, r.Y)
	lat := math.Atan2(r.Z, p*(1-eccentricitySquared))

	var n, h float64
	for i := 0; i < 6; i++ {
		sinLat := math.Sin(lat)
		n = EarthRadiusM / math.Sqrt(1-eccentricitySquared*sinLat*sinLat)
		h = p/math.Cos(lat) - n
		lat = math.Atan2(r.Z, p*(1-eccentricitySquared*n/(n+h)))
	}
	sinLat := math.Sin(lat)
	n = EarthRadiusM / math.Sqrt(1-eccentricitySquared*sinLat*sinLat)

	return Geodetic{
		LatDeg:    lat * 180 / math.Pi,
		LonDeg:    lon * 180 / math.Pi,
		AltitudeM: p/math.Cos(lat) - n,
	}
}

// UpAt returns the geodetic "up" unit vector at a latitude and longitude: the
// outward normal to the ellipsoid, which is what both the off-nadir angle and
// the horizon check are measured against.
func UpAt(latDeg, lonDeg float64) Vec3 {
	lat := latDeg * math.Pi / 180
	lon := lonDeg * math.Pi / 180
	sinLat, cosLat := math.Sincos(lat)
	sinLon, cosLon := math.Sincos(lon)
	return Vec3{cosLat * cosLon, cosLat * sinLon, sinLat}
}

// NorthAt returns the local north unit vector at a latitude and longitude.
func NorthAt(latDeg, lonDeg float64) Vec3 {
	lat := latDeg * math.Pi / 180
	lon := lonDeg * math.Pi / 180
	sinLat, cosLat := math.Sincos(lat)
	sinLon, cosLon := math.Sincos(lon)
	return Vec3{-sinLat * cosLon, -sinLat * sinLon, cosLat}
}

// TEMEToECEF rotates a TEME vector into ECEF about the Z axis by the sidereal
// angle. SGP4 produces TEME; latitude and longitude only mean anything in ECEF.
func TEMEToECEF(v Vec3, gmstRad float64) Vec3 {
	sin, cos := math.Sincos(gmstRad)
	return Vec3{
		X: cos*v.X + sin*v.Y,
		Y: -sin*v.X + cos*v.Y,
		Z: v.Z,
	}
}

// TEMEVelocityToECEF rotates a velocity and then removes the rotating-frame
// term. Rotating the vector is not enough: an observer standing on the turning
// Earth also sees the ground move underneath. Notebook 03 flags this as the
// trap — forget the omega x r subtraction and every derived orbital element,
// look side and pass direction comes out wrong.
func TEMEVelocityToECEF(vTEME Vec3, rECEF Vec3, gmstRad float64) Vec3 {
	omega := Vec3{0, 0, EarthRotationRate}
	return TEMEToECEF(vTEME, gmstRad).Sub(omega.Cross(rECEF))
}
