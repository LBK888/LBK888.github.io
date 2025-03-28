/**
 * smooth-scroll v5.1.3
 * Animate scrolling to anchor links, by Chris Ferdinandi.
 * http://github.com/cferdinandi/smooth-scroll
 *
 * Free to use under the MIT License.
 * http://gomakethings.com/mit/
 */

/*
 * Polyfill Function.prototype.bind support for otherwise ECMA Script 5 compliant browsers
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/bind#Compatibility
 */

if (!Function.prototype.bind) {
  Function.prototype.bind = function (oThis) {
    if (typeof this !== "function") {
      // closest thing possible to the ECMAScript 5
      // internal IsCallable function
      throw new TypeError("Function.prototype.bind - what is trying to be bound is not callable");
    }

    var aArgs = Array.prototype.slice.call(arguments, 1);
    var fToBind = this;
    fNOP = function () {};
    fBound = function () {
      return fToBind.apply(this instanceof fNOP && oThis ? this : oThis, aArgs.concat(Array.prototype.slice.call(arguments)));
    };

    fNOP.prototype = this.prototype;
    fBound.prototype = new fNOP();

    return fBound;
  };
}
