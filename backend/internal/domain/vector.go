package domain

import "math"

// Vec3 is a 3D vector in metres (or metres per second for a velocity).
// It is deliberately a value type: every operation returns a new Vec3, so no
// caller can mutate a vector another goroutine is reading.
type Vec3 struct {
	X, Y, Z float64
}

func (a Vec3) Add(b Vec3) Vec3 { return Vec3{a.X + b.X, a.Y + b.Y, a.Z + b.Z} }

func (a Vec3) Sub(b Vec3) Vec3 { return Vec3{a.X - b.X, a.Y - b.Y, a.Z - b.Z} }

func (a Vec3) Scale(f float64) Vec3 { return Vec3{a.X * f, a.Y * f, a.Z * f} }

func (a Vec3) Dot(b Vec3) float64 { return a.X*b.X + a.Y*b.Y + a.Z*b.Z }

func (a Vec3) Cross(b Vec3) Vec3 {
	return Vec3{
		a.Y*b.Z - a.Z*b.Y,
		a.Z*b.X - a.X*b.Z,
		a.X*b.Y - a.Y*b.X,
	}
}

func (a Vec3) Norm() float64 { return math.Sqrt(a.Dot(a)) }

// Unit returns the vector scaled to length 1. A zero vector is returned
// unchanged rather than producing NaN, because a NaN here would silently
// poison every angle computed downstream.
func (a Vec3) Unit() Vec3 {
	n := a.Norm()
	if n == 0 {
		return a
	}
	return a.Scale(1 / n)
}

// angleBetweenUnitVectors returns the angle in degrees between two unit
// vectors. The clamp guards against floating point pushing the dot product a
// hair outside [-1, 1], which would make Acos return NaN.
func angleBetweenUnitVectors(a, b Vec3) float64 {
	d := math.Max(-1, math.Min(1, a.Dot(b)))
	return math.Acos(d) * 180 / math.Pi
}
