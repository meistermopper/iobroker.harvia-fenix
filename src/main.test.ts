import { expect } from "chai";
import { HarviaFenix } from "./main";

describe("HarviaFenix utility methods", () => {
	describe("isTrue", () => {
		it("should return true for valid boolean-like values", () => {
			expect(HarviaFenix.isTrue(true)).to.be.true;
			expect(HarviaFenix.isTrue("true")).to.be.true;
			expect(HarviaFenix.isTrue("on")).to.be.true;
			expect(HarviaFenix.isTrue(1)).to.be.true;
			expect(HarviaFenix.isTrue("1")).to.be.true;
		});

		it("should return true for Harvia specific status codes", () => {
			expect(HarviaFenix.isTrue(21)).to.be.true;
			expect(HarviaFenix.isTrue("21")).to.be.true;
			expect(HarviaFenix.isTrue(23)).to.be.true;
			expect(HarviaFenix.isTrue("ready")).to.be.true;
		});

		it("should return false for falsy values", () => {
			expect(HarviaFenix.isTrue(false)).to.be.false;
			expect(HarviaFenix.isTrue("false")).to.be.false;
			expect(HarviaFenix.isTrue(0)).to.be.false;
			expect(HarviaFenix.isTrue(null)).to.be.false;
			expect(HarviaFenix.isTrue(undefined)).to.be.false;
			expect(HarviaFenix.isTrue("off")).to.be.false;
			expect(HarviaFenix.isTrue("unknown")).to.be.false;
		});
	});

	describe("calculateNumericValue", () => {
		it("should correctly scale and round values", () => {
			// Temperature rounding (1 decimal)
			expect(HarviaFenix.calculateNumericValue(25.678)).to.equal(25.7);
			// Power conversion (Watts to kW, 2 decimals)
			expect(HarviaFenix.calculateNumericValue(4500, 0.001, 2)).to.equal(4.5);
			expect(HarviaFenix.calculateNumericValue("4567", 0.001, 2)).to.equal(
				4.57,
			);
		});

		it("should return undefined for invalid inputs", () => {
			expect(HarviaFenix.calculateNumericValue(null)).to.be.undefined;
			expect(HarviaFenix.calculateNumericValue(undefined)).to.be.undefined;
			expect(HarviaFenix.calculateNumericValue("not a number")).to.be.undefined;
		});
	});
});
// ... more test suites => describe
