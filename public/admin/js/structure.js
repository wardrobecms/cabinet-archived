/**
 * sifter.js
 * Copyright (c) 2013 Brian Reavis & contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this
 * file except in compliance with the License. You may obtain a copy of the License at:
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
 * ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 *
 * @author Brian Reavis <brian@thirdroute.com>
 */

(function(root, factory) {
	if (typeof define === 'function' && define.amd) {
		define(factory);
	} else if (typeof exports === 'object') {
		module.exports = factory();
	} else {
		root.Sifter = factory();
	}
}(this, function() {

	/**
	 * Textually searches arrays and hashes of objects
	 * by property (or multiple properties). Designed
	 * specifically for autocomplete.
	 *
	 * @constructor
	 * @param {array|object} items
	 * @param {object} items
	 */
	var Sifter = function(items, settings) {
		this.items = items;
		this.settings = settings || {diacritics: true};
	};

	/**
	 * Splits a search string into an array of individual
	 * regexps to be used to match results.
	 *
	 * @param {string} query
	 * @returns {array}
	 */
	Sifter.prototype.tokenize = function(query) {
		query = trim(String(query || '').toLowerCase());
		if (!query || !query.length) return [];

		var i, n, regex, letter;
		var tokens = [];
		var words = query.split(/ +/);

		for (i = 0, n = words.length; i < n; i++) {
			regex = escape_regex(words[i]);
			if (this.settings.diacritics) {
				for (letter in DIACRITICS) {
					if (DIACRITICS.hasOwnProperty(letter)) {
						regex = regex.replace(new RegExp(letter, 'g'), DIACRITICS[letter]);
					}
				}
			}
			tokens.push({
				string : words[i],
				regex  : new RegExp(regex, 'i')
			});
		}

		return tokens;
	};

	/**
	 * Iterates over arrays and hashes.
	 *
	 * ```
	 * this.iterator(this.items, function(item, id) {
	 *    // invoked for each item
	 * });
	 * ```
	 *
	 * @param {array|object} object
	 */
	Sifter.prototype.iterator = function(object, callback) {
		var iterator;
		if (is_array(object)) {
			iterator = Array.prototype.forEach || function(callback) {
				for (var i = 0, n = this.length; i < n; i++) {
					callback(this[i], i, this);
				}
			};
		} else {
			iterator = function(callback) {
				for (var key in this) {
					if (this.hasOwnProperty(key)) {
						callback(this[key], key, this);
					}
				}
			};
		}

		iterator.apply(object, [callback]);
	};

	/**
	 * Returns a function to be used to score individual results.
	 *
	 * Good matches will have a higher score than poor matches.
	 * If an item is not a match, 0 will be returned by the function.
	 *
	 * @param {object|string} search
	 * @param {object} options (optional)
	 * @returns {function}
	 */
	Sifter.prototype.getScoreFunction = function(search, options) {
		var self, fields, tokens, token_count;

		self        = this;
		search      = self.prepareSearch(search, options);
		tokens      = search.tokens;
		fields      = search.options.fields;
		token_count = tokens.length;

		/**
		 * Calculates how close of a match the
		 * given value is against a search token.
		 *
		 * @param {mixed} value
		 * @param {object} token
		 * @return {number}
		 */
		var scoreValue = function(value, token) {
			var score, pos;

			if (!value) return 0;
			value = String(value || '');
			pos = value.search(token.regex);
			if (pos === -1) return 0;
			score = token.string.length / value.length;
			if (pos === 0) score += 0.5;
			return score;
		};

		/**
		 * Calculates the score of an object
		 * against the search query.
		 *
		 * @param {object} token
		 * @param {object} data
		 * @return {number}
		 */
		var scoreObject = (function() {
			var field_count = fields.length;
			if (!field_count) {
				return function() { return 0; };
			}
			if (field_count === 1) {
				return function(token, data) {
					return scoreValue(data[fields[0]], token);
				};
			}
			return function(token, data) {
				for (var i = 0, sum = 0; i < field_count; i++) {
					sum += scoreValue(data[fields[i]], token);
				}
				return sum / field_count;
			};
		})();

		if (!token_count) {
			return function() { return 0; };
		}
		if (token_count === 1) {
			return function(data) {
				return scoreObject(tokens[0], data);
			};
		}
		return function(data) {
			for (var i = 0, sum = 0; i < token_count; i++) {
				sum += scoreObject(tokens[i], data);
			}
			return sum / token_count;
		};
	};

	/**
	 * Parses a search query and returns an object
	 * with tokens and fields ready to be populated
	 * with results.
	 *
	 * @param {string} query
	 * @param {object} options
	 * @returns {object}
	 */
	Sifter.prototype.prepareSearch = function(query, options) {
		if (typeof query === 'object') return query;
		return {
			options : extend({}, options),
			query   : String(query || '').toLowerCase(),
			tokens  : this.tokenize(query),
			total   : 0,
			items   : []
		};
	};

	/**
	 * Searches through all items and returns a sorted array of matches.
	 *
	 * The `options` parameter can contain:
	 *
	 *   - fields {string|array}
	 *   - sort {string}
	 *   - direction {string}
	 *   - score {function}
	 *   - limit {integer}
	 *
	 * Returns an object containing:
	 *
	 *   - options {object}
	 *   - query {string}
	 *   - tokens {array}
	 *   - total {int}
	 *   - items {array}
	 *
	 * @param {string} query
	 * @param {object} options
	 * @returns {object}
	 */
	Sifter.prototype.search = function(query, options) {
		var self = this, value, score, search, calculateScore;

		search  = this.prepareSearch(query, options);
		options = search.options;
		query   = search.query;

		// generate result scoring function
		if (!is_array(options.fields)) options.fields = [options.fields];
		calculateScore = options.score || self.getScoreFunction(search);

		// perform search and sort
		if (query.length) {
			self.iterator(self.items, function(item, id) {
				score = calculateScore(item);
				if (score > 0) {
					search.items.push({'score': score, 'id': id});
				}
			});
			search.items.sort(function(a, b) {
				return b.score - a.score;
			});
		} else {
			self.iterator(self.items, function(item, id) {
				search.items.push({'score': 1, 'id': id});
			});
			if (options.sort) {
				search.items.sort((function() {
					var field = options.sort;
					var multiplier = options.direction === 'desc' ? -1 : 1;
					return function(a, b) {
						return cmp(self.items[a.id][field], self.items[b.id][field]) * multiplier;
					};
				})());
			}
		}

		// apply limits
		search.total = search.items.length;
		if (typeof options.limit === 'number') {
			search.items = search.items.slice(0, options.limit);
		}

		return search;
	};

	// utilities
	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	var cmp = function(a, b) {
		if (typeof a === 'number' && typeof b === 'number') {
			return a > b ? 1 : (a < b ? -1 : 0);
		}
		a = String(a || '').toLowerCase();
		b = String(b || '').toLowerCase();
		if (a > b) return 1;
		if (b > a) return -1;
		return 0;
	};

	var extend = function(a, b) {
		var i, n, k, object;
		for (i = 1, n = arguments.length; i < n; i++) {
			object = arguments[i];
			if (!object) continue;
			for (k in object) {
				if (object.hasOwnProperty(k)) {
					a[k] = object[k];
				}
			}
		}
		return a;
	};

	var trim = function(str) {
		return (str + '').replace(/^\s+|\s+$|/g, '');
	};

	var escape_regex = function(str) {
		return (str + '').replace(/([.?*+^$[\]\\(){}|-])/g, '\\$1');
	};

	var is_array = Array.isArray || ($ && $.isArray) || function(object) {
		return Object.prototype.toString.call(object) === '[object Array]';
	};

	var DIACRITICS = {
		'a': '[aÀÁÂÃÄÅàáâãäå]',
		'c': '[cÇç]',
		'e': '[eÈÉÊËèéêë]',
		'i': '[iÌÍÎÏìíîï]',
		'n': '[nÑñ]',
		'o': '[oÒÓÔÕÕÖØòóôõöø]',
		's': '[sŠš]',
		'u': '[uÙÚÛÜùúûü]',
		'y': '[yŸÿý]',
		'z': '[zŽž]'
	};

	// export
	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	return Sifter;

}));

/**
 * microplugin.js
 * Copyright (c) 2013 Brian Reavis & contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this
 * file except in compliance with the License. You may obtain a copy of the License at:
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
 * ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 *
 * @author Brian Reavis <brian@thirdroute.com>
 */

(function(root, factory) {
	if (typeof define === 'function' && define.amd) {
		define(factory);
	} else if (typeof exports === 'object') {
		module.exports = factory();
	} else {
		root.MicroPlugin = factory();
	}
}(this, function() {
	var MicroPlugin = {};

	MicroPlugin.mixin = function(Interface) {
		Interface.plugins = {};

		/**
		 * Initializes the listed plugins (with options).
		 * Acceptable formats:
		 *
		 * List (without options):
		 *   ['a', 'b', 'c']
		 *
		 * List (with options):
		 *   [{'name': 'a', options: {}}, {'name': 'b', options: {}}]
		 *
		 * Hash (with options):
		 *   {'a': { ... }, 'b': { ... }, 'c': { ... }}
		 *
		 * @param {mixed} plugins
		 */
		Interface.prototype.initializePlugins = function(plugins) {
			var i, n, key;
			var self  = this;
			var queue = [];

			self.plugins = {
				names     : [],
				settings  : {},
				requested : {},
				loaded    : {}
			};

			if (utils.isArray(plugins)) {
				for (i = 0, n = plugins.length; i < n; i++) {
					if (typeof plugins[i] === 'string') {
						queue.push(plugins[i]);
					} else {
						self.plugins.settings[plugins[i].name] = plugins[i].options;
						queue.push(plugins[i].name);
					}
				}
			} else if (plugins) {
				for (key in plugins) {
					if (plugins.hasOwnProperty(key)) {
						self.plugins.settings[key] = plugins[key];
						queue.push(key);
					}
				}
			}

			while (queue.length) {
				self.require(queue.shift());
			}
		};

		Interface.prototype.loadPlugin = function(name) {
			var self    = this;
			var plugins = self.plugins;
			var plugin  = Interface.plugins[name];

			if (!Interface.plugins.hasOwnProperty(name)) {
				throw new Error('Unable to find "' +  name + '" plugin');
			}

			plugins.requested[name] = true;
			plugins.loaded[name] = plugin.fn.apply(self, [self.plugins.settings[name] || {}]);
			plugins.names.push(name);
		};

		/**
		 * Initializes a plugin.
		 *
		 * @param {string} name
		 */
		Interface.prototype.require = function(name) {
			var self = this;
			var plugins = self.plugins;

			if (!self.plugins.loaded.hasOwnProperty(name)) {
				if (plugins.requested[name]) {
					throw new Error('Plugin has circular dependency ("' + name + '")');
				}
				self.loadPlugin(name);
			}

			return plugins.loaded[name];
		};

		/**
		 * Registers a plugin.
		 *
		 * @param {string} name
		 * @param {function} fn
		 */
		Interface.define = function(name, fn) {
			Interface.plugins[name] = {
				'name' : name,
				'fn'   : fn
			};
		};
	};

	var utils = {
		isArray: Array.isArray || function(vArg) {
			return Object.prototype.toString.call(vArg) === '[object Array]';
		}
	};

	return MicroPlugin;
}));

/**
 * selectize.js (v0.7.7)
 * Copyright (c) 2013 Brian Reavis & contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this
 * file except in compliance with the License. You may obtain a copy of the License at:
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF
 * ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 *
 * @author Brian Reavis <brian@thirdroute.com>
 */

/*jshint curly:false */
/*jshint browser:true */

(function(root, factory) {
	if (typeof define === 'function' && define.amd) {
		define(['jquery','sifter','microplugin'], factory);
	} else {
		root.Selectize = factory(root.jQuery, root.Sifter, root.MicroPlugin);
	}
}(this, function($, Sifter, MicroPlugin) {
	'use strict';

	var highlight = function($element, pattern) {
		if (typeof pattern === 'string' && !pattern.length) return;
		var regex = (typeof pattern === 'string') ? new RegExp(pattern, 'i') : pattern;
	
		var highlight = function(node) {
			var skip = 0;
			if (node.nodeType === 3) {
				var pos = node.data.search(regex);
				if (pos >= 0 && node.data.length > 0) {
					var match = node.data.match(regex);
					var spannode = document.createElement('span');
					spannode.className = 'highlight';
					var middlebit = node.splitText(pos);
					var endbit = middlebit.splitText(match[0].length);
					var middleclone = middlebit.cloneNode(true);
					spannode.appendChild(middleclone);
					middlebit.parentNode.replaceChild(spannode, middlebit);
					skip = 1;
				}
			} else if (node.nodeType === 1 && node.childNodes && !/(script|style)/i.test(node.tagName)) {
				for (var i = 0; i < node.childNodes.length; ++i) {
					i += highlight(node.childNodes[i]);
				}
			}
			return skip;
		};
	
		return $element.each(function() {
			highlight(this);
		});
	};
	
	var MicroEvent = function() {};
	MicroEvent.prototype = {
		on: function(event, fct){
			this._events = this._events || {};
			this._events[event] = this._events[event] || [];
			this._events[event].push(fct);
		},
		off: function(event, fct){
			var n = arguments.length;
			if (n === 0) return delete this._events;
			if (n === 1) return delete this._events[event];
	
			this._events = this._events || {};
			if (event in this._events === false) return;
			this._events[event].splice(this._events[event].indexOf(fct), 1);
		},
		trigger: function(event /* , args... */){
			this._events = this._events || {};
			if (event in this._events === false) return;
			for (var i = 0; i < this._events[event].length; i++){
				this._events[event][i].apply(this, Array.prototype.slice.call(arguments, 1));
			}
		}
	};
	
	/**
	 * Mixin will delegate all MicroEvent.js function in the destination object.
	 *
	 * - MicroEvent.mixin(Foobar) will make Foobar able to use MicroEvent
	 *
	 * @param {object} the object which will support MicroEvent
	 */
	MicroEvent.mixin = function(destObject){
		var props = ['on', 'off', 'trigger'];
		for (var i = 0; i < props.length; i++){
			destObject.prototype[props[i]] = MicroEvent.prototype[props[i]];
		}
	};
	
	var IS_MAC        = /Mac/.test(navigator.userAgent);
	
	var KEY_A         = 65;
	var KEY_COMMA     = 188;
	var KEY_RETURN    = 13;
	var KEY_ESC       = 27;
	var KEY_LEFT      = 37;
	var KEY_UP        = 38;
	var KEY_RIGHT     = 39;
	var KEY_DOWN      = 40;
	var KEY_BACKSPACE = 8;
	var KEY_DELETE    = 46;
	var KEY_SHIFT     = 16;
	var KEY_CMD       = IS_MAC ? 91 : 17;
	var KEY_CTRL      = IS_MAC ? 18 : 17;
	var KEY_TAB       = 9;
	
	var TAG_SELECT    = 1;
	var TAG_INPUT     = 2;
	
	var isset = function(object) {
		return typeof object !== 'undefined';
	};
	
	/**
	 * Converts a scalar to its best string representation
	 * for hash keys and HTML attribute values.
	 *
	 * Transformations:
	 *   'str'     -> 'str'
	 *   null      -> ''
	 *   undefined -> ''
	 *   true      -> '1'
	 *   false     -> '0'
	 *   0         -> '0'
	 *   1         -> '1'
	 *
	 * @param {string} value
	 * @returns {string}
	 */
	var hash_key = function(value) {
		if (typeof value === 'undefined' || value === null) return '';
		if (typeof value === 'boolean') return value ? '1' : '0';
		return value + '';
	};
	
	/**
	 * Escapes a string for use within HTML.
	 *
	 * @param {string} str
	 * @returns {string}
	 */
	var escape_html = function(str) {
		return (str + '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	};
	
	var hook = {};
	
	/**
	 * Wraps `method` on `self` so that `fn`
	 * is invoked before the original method.
	 *
	 * @param {object} self
	 * @param {string} method
	 * @param {function} fn
	 */
	hook.before = function(self, method, fn) {
		var original = self[method];
		self[method] = function() {
			fn.apply(self, arguments);
			return original.apply(self, arguments);
		};
	};
	
	/**
	 * Wraps `method` on `self` so that `fn`
	 * is invoked after the original method.
	 *
	 * @param {object} self
	 * @param {string} method
	 * @param {function} fn
	 */
	hook.after = function(self, method, fn) {
		var original = self[method];
		self[method] = function() {
			var result = original.apply(self, arguments);
			fn.apply(self, arguments);
			return result;
		};
	};
	
	/**
	 * Builds a hash table out of an array of
	 * objects, using the specified `key` within
	 * each object.
	 *
	 * @param {string} key
	 * @param {mixed} objects
	 */
	var build_hash_table = function(key, objects) {
		if (!$.isArray(objects)) return objects;
		var i, n, table = {};
		for (i = 0, n = objects.length; i < n; i++) {
			if (objects[i].hasOwnProperty(key)) {
				table[objects[i][key]] = objects[i];
			}
		}
		return table;
	};
	
	/**
	 * Wraps `fn` so that it can only be invoked once.
	 *
	 * @param {function} fn
	 * @returns {function}
	 */
	var once = function(fn) {
		var called = false;
		return function() {
			if (called) return;
			called = true;
			fn.apply(this, arguments);
		};
	};
	
	/**
	 * Wraps `fn` so that it can only be called once
	 * every `delay` milliseconds (invoked on the falling edge).
	 *
	 * @param {function} fn
	 * @param {int} delay
	 * @returns {function}
	 */
	var debounce = function(fn, delay) {
		var timeout;
		return function() {
			var self = this;
			var args = arguments;
			window.clearTimeout(timeout);
			timeout = window.setTimeout(function() {
				fn.apply(self, args);
			}, delay);
		};
	};
	
	/**
	 * Debounce all fired events types listed in `types`
	 * while executing the provided `fn`.
	 *
	 * @param {object} self
	 * @param {array} types
	 * @param {function} fn
	 */
	var debounce_events = function(self, types, fn) {
		var type;
		var trigger = self.trigger;
		var event_args = {};
	
		// override trigger method
		self.trigger = function() {
			var type = arguments[0];
			if (types.indexOf(type) !== -1) {
				event_args[type] = arguments;
			} else {
				return trigger.apply(self, arguments);
			}
		};
	
		// invoke provided function
		fn.apply(self, []);
		self.trigger = trigger;
	
		// trigger queued events
		for (type in event_args) {
			if (event_args.hasOwnProperty(type)) {
				trigger.apply(self, event_args[type]);
			}
		}
	};
	
	/**
	 * A workaround for http://bugs.jquery.com/ticket/6696
	 *
	 * @param {object} $parent - Parent element to listen on.
	 * @param {string} event - Event name.
	 * @param {string} selector - Descendant selector to filter by.
	 * @param {function} fn - Event handler.
	 */
	var watchChildEvent = function($parent, event, selector, fn) {
		$parent.on(event, selector, function(e) {
			var child = e.target;
			while (child && child.parentNode !== $parent[0]) {
				child = child.parentNode;
			}
			e.currentTarget = child;
			return fn.apply(this, [e]);
		});
	};
	
	/**
	 * Determines the current selection within a text input control.
	 * Returns an object containing:
	 *   - start
	 *   - length
	 *
	 * @param {object} input
	 * @returns {object}
	 */
	var getSelection = function(input) {
		var result = {};
		if ('selectionStart' in input) {
			result.start = input.selectionStart;
			result.length = input.selectionEnd - result.start;
		} else if (document.selection) {
			input.focus();
			var sel = document.selection.createRange();
			var selLen = document.selection.createRange().text.length;
			sel.moveStart('character', -input.value.length);
			result.start = sel.text.length - selLen;
			result.length = selLen;
		}
		return result;
	};
	
	/**
	 * Copies CSS properties from one element to another.
	 *
	 * @param {object} $from
	 * @param {object} $to
	 * @param {array} properties
	 */
	var transferStyles = function($from, $to, properties) {
		var i, n, styles = {};
		if (properties) {
			for (i = 0, n = properties.length; i < n; i++) {
				styles[properties[i]] = $from.css(properties[i]);
			}
		} else {
			styles = $from.css();
		}
		$to.css(styles);
	};
	
	/**
	 * Measures the width of a string within a
	 * parent element (in pixels).
	 *
	 * @param {string} str
	 * @param {object} $parent
	 * @returns {int}
	 */
	var measureString = function(str, $parent) {
		var $test = $('<test>').css({
			position: 'absolute',
			top: -99999,
			left: -99999,
			width: 'auto',
			padding: 0,
			whiteSpace: 'nowrap'
		}).text(str).appendTo('body');
	
		transferStyles($parent, $test, [
			'letterSpacing',
			'fontSize',
			'fontFamily',
			'fontWeight',
			'textTransform'
		]);
	
		var width = $test.width();
		$test.remove();
	
		return width;
	};
	
	/**
	 * Sets up an input to grow horizontally as the user
	 * types. If the value is changed manually, you can
	 * trigger the "update" handler to resize:
	 *
	 * $input.trigger('update');
	 *
	 * @param {object} $input
	 */
	var autoGrow = function($input) {
		var update = function(e) {
			var value, keyCode, printable, placeholder, width;
			var shift, character, selection;
			e = e || window.event || {};
	
			if (e.metaKey || e.altKey) return;
			if ($input.data('grow') === false) return;
	
			value = $input.val();
			if (e.type && e.type.toLowerCase() === 'keydown') {
				keyCode = e.keyCode;
				printable = (
					(keyCode >= 97 && keyCode <= 122) || // a-z
					(keyCode >= 65 && keyCode <= 90)  || // A-Z
					(keyCode >= 48 && keyCode <= 57)  || // 0-9
					keyCode === 32 // space
				);
	
				if (keyCode === KEY_DELETE || keyCode === KEY_BACKSPACE) {
					selection = getSelection($input[0]);
					if (selection.length) {
						value = value.substring(0, selection.start) + value.substring(selection.start + selection.length);
					} else if (keyCode === KEY_BACKSPACE && selection.start) {
						value = value.substring(0, selection.start - 1) + value.substring(selection.start + 1);
					} else if (keyCode === KEY_DELETE && typeof selection.start !== 'undefined') {
						value = value.substring(0, selection.start) + value.substring(selection.start + 1);
					}
				} else if (printable) {
					shift = e.shiftKey;
					character = String.fromCharCode(e.keyCode);
					if (shift) character = character.toUpperCase();
					else character = character.toLowerCase();
					value += character;
				}
			}
	
			placeholder = $input.attr('placeholder') || '';
			if (!value.length && placeholder.length) {
				value = placeholder;
			}
	
			width = measureString(value, $input) + 4;
			if (width !== $input.width()) {
				$input.width(width);
				$input.triggerHandler('resize');
			}
		};
	
		$input.on('keydown keyup update blur', update);
		update();
	};
	
	var Selectize = function($input, settings) {
		var key, i, n, self = this;
		$input[0].selectize = self;
	
		// setup default state
		$.extend(self, {
			settings         : settings,
			$input           : $input,
			tagType          : $input[0].tagName.toLowerCase() === 'select' ? TAG_SELECT : TAG_INPUT,
	
			eventNS          : '.selectize' + (++Selectize.count),
			highlightedValue : null,
			isOpen           : false,
			isDisabled       : false,
			isLocked         : false,
			isFocused        : false,
			isInputFocused   : false,
			isInputHidden    : false,
			isSetup          : false,
			isShiftDown      : false,
			isCmdDown        : false,
			isCtrlDown       : false,
			ignoreFocus      : false,
			ignoreHover      : false,
			hasOptions       : false,
			currentResults   : null,
			lastValue        : '',
			caretPos         : 0,
			loading          : 0,
			loadedSearches   : {},
	
			$activeOption    : null,
			$activeItems     : [],
	
			optgroups        : {},
			options          : {},
			userOptions      : {},
			items            : [],
			renderCache      : {},
			onSearchChange   : debounce(self.onSearchChange, settings.loadThrottle)
		});
	
		// search system
		self.sifter = new Sifter(this.options, {diacritics: settings.diacritics});
	
		// build options table
		$.extend(self.options, build_hash_table(settings.valueField, settings.options));
		delete self.settings.options;
	
		// build optgroup table
		$.extend(self.optgroups, build_hash_table(settings.optgroupValueField, settings.optgroups));
		delete self.settings.optgroups;
	
		// option-dependent defaults
		self.settings.mode = self.settings.mode || (self.settings.maxItems === 1 ? 'single' : 'multi');
		if (typeof self.settings.hideSelected !== 'boolean') {
			self.settings.hideSelected = self.settings.mode === 'multi';
		}
	
		self.initializePlugins(self.settings.plugins);
		self.setupCallbacks();
		self.setupTemplates();
		self.setup();
	};
	
	// mixins
	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
	
	MicroEvent.mixin(Selectize);
	MicroPlugin.mixin(Selectize);
	
	// methods
	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
	
	$.extend(Selectize.prototype, {
	
		/**
		 * Creates all elements and sets up event bindings.
		 */
		setup: function() {
			var self      = this;
			var settings  = self.settings;
			var eventNS   = self.eventNS;
			var $window   = $(window);
			var $document = $(document);
	
			var $wrapper;
			var $control;
			var $control_input;
			var $dropdown;
			var $dropdown_content;
			var $dropdown_parent;
			var inputMode;
			var timeout_blur;
			var timeout_focus;
			var tab_index;
			var classes;
			var classes_plugins;
	
			inputMode         = self.settings.mode;
			tab_index         = self.$input.attr('tabindex') || '';
			classes           = self.$input.attr('class') || '';
	
			$wrapper          = $('<div>').addClass(settings.wrapperClass).addClass(classes).addClass(inputMode);
			$control          = $('<div>').addClass(settings.inputClass).addClass('items').appendTo($wrapper);
			$control_input    = $('<input type="text">').appendTo($control).attr('tabindex', tab_index);
			$dropdown_parent  = $(settings.dropdownParent || $wrapper);
			$dropdown         = $('<div>').addClass(settings.dropdownClass).addClass(classes).addClass(inputMode).hide().appendTo($dropdown_parent);
			$dropdown_content = $('<div>').addClass(settings.dropdownContentClass).appendTo($dropdown);
	
			$wrapper.css({
				width: self.$input[0].style.width
			});
	
			if (self.plugins.names.length) {
				classes_plugins = 'plugin-' + self.plugins.names.join(' plugin-');
				$wrapper.addClass(classes_plugins);
				$dropdown.addClass(classes_plugins);
			}
	
			if ((settings.maxItems === null || settings.maxItems > 1) && self.tagType === TAG_SELECT) {
				self.$input.attr('multiple', 'multiple');
			}
	
			if (self.settings.placeholder) {
				$control_input.attr('placeholder', settings.placeholder);
			}
	
			self.$wrapper          = $wrapper;
			self.$control          = $control;
			self.$control_input    = $control_input;
			self.$dropdown         = $dropdown;
			self.$dropdown_content = $dropdown_content;
	
			$control.on('mousedown', function(e) {
				if (!e.isDefaultPrevented()) {
					window.setTimeout(function() {
						self.focus(true);
					}, 0);
				}
			});
	
			// necessary for mobile webkit devices (manual focus triggering
			// is ignored unless invoked within a click event)
			$control.on('click', function(e) {
				if (!self.isInputFocused) {
					self.focus(true);
				}
			});
	
			$dropdown.on('mouseenter', '[data-selectable]', function() { return self.onOptionHover.apply(self, arguments); });
			$dropdown.on('mousedown', '[data-selectable]', function() { return self.onOptionSelect.apply(self, arguments); });
			watchChildEvent($control, 'mousedown', '*:not(input)', function() { return self.onItemSelect.apply(self, arguments); });
			autoGrow($control_input);
	
			$control_input.on({
				mousedown : function(e) { e.stopPropagation(); },
				keydown   : function() { return self.onKeyDown.apply(self, arguments); },
				keyup     : function() { return self.onKeyUp.apply(self, arguments); },
				keypress  : function() { return self.onKeyPress.apply(self, arguments); },
				resize    : function() { self.positionDropdown.apply(self, []); },
				blur      : function() { return self.onBlur.apply(self, arguments); },
				focus     : function() { return self.onFocus.apply(self, arguments); }
			});
	
			$document.on('keydown' + eventNS, function(e) {
				self.isCmdDown = e[IS_MAC ? 'metaKey' : 'ctrlKey'];
				self.isCtrlDown = e[IS_MAC ? 'altKey' : 'ctrlKey'];
				self.isShiftDown = e.shiftKey;
			});
	
			$document.on('keyup' + eventNS, function(e) {
				if (e.keyCode === KEY_CTRL) self.isCtrlDown = false;
				if (e.keyCode === KEY_SHIFT) self.isShiftDown = false;
				if (e.keyCode === KEY_CMD) self.isCmdDown = false;
			});
	
			$document.on('mousedown' + eventNS, function(e) {
				if (self.isFocused) {
					// prevent events on the dropdown scrollbar from causing the control to blur
					if (e.target === self.$dropdown[0] || e.target.parentNode === self.$dropdown[0]) {
						var ignoreFocus = self.ignoreFocus;
						self.ignoreFocus = true;
						window.setTimeout(function() {
							self.ignoreFocus = ignoreFocus;
							self.focus(false);
						}, 0);
						return;
					}
					// blur on click outside
					if (!self.$control.has(e.target).length && e.target !== self.$control[0]) {
						self.blur();
					}
				}
			});
	
			$window.on(['scroll' + eventNS, 'resize' + eventNS].join(' '), function() {
				if (self.isOpen) {
					self.positionDropdown.apply(self, arguments);
				}
			});
			$window.on('mousemove' + eventNS, function() {
				self.ignoreHover = false;
			});
	
			self.$input.attr('tabindex',-1).hide().after(self.$wrapper);
	
			if ($.isArray(settings.items)) {
				self.setValue(settings.items);
				delete settings.items;
			}
	
			self.updateOriginalInput();
			self.refreshItems();
			self.refreshClasses();
			self.updatePlaceholder();
			self.isSetup = true;
	
			if (self.$input.is(':disabled')) {
				self.disable();
			}
	
			self.on('change', this.onChange);
			self.trigger('initialize');
	
			// preload options
			if (settings.preload) {
				self.onSearchChange('');
			}
		},
	
		/**
		 * Sets up default rendering functions.
		 */
		setupTemplates: function() {
			var self = this;
			var field_label = self.settings.labelField;
			var field_optgroup = self.settings.optgroupLabelField;
	
			var templates = {
				'optgroup': function(data) {
					return '<div class="optgroup">' + data.html + '</div>';
				},
				'optgroup_header': function(data, escape) {
					return '<div class="optgroup-header">' + escape(data[field_optgroup]) + '</div>';
				},
				'option': function(data, escape) {
					return '<div class="option">' + escape(data[field_label]) + '</div>';
				},
				'item': function(data, escape) {
					return '<div class="item">' + escape(data[field_label]) + '</div>';
				},
				'option_create': function(data, escape) {
					return '<div class="create">Add <strong>' + escape(data.input) + '</strong>&hellip;</div>';
				},
			};
	
			self.settings.render = $.extend({}, templates, self.settings.render);
		},
	
		/**
		 * Maps fired events to callbacks provided
		 * in the settings used when creating the control.
		 */
		setupCallbacks: function() {
			var key, fn, callbacks = {
				'initialize'     : 'onInitialize',
				'change'         : 'onChange',
				'item_add'       : 'onItemAdd',
				'item_remove'    : 'onItemRemove',
				'clear'          : 'onClear',
				'option_add'     : 'onOptionAdd',
				'option_remove'  : 'onOptionRemove',
				'option_clear'   : 'onOptionClear',
				'dropdown_open'  : 'onDropdownOpen',
				'dropdown_close' : 'onDropdownClose',
				'type'           : 'onType'
			};
	
			for (key in callbacks) {
				if (callbacks.hasOwnProperty(key)) {
					fn = this.settings[callbacks[key]];
					if (fn) this.on(key, fn);
				}
			}
		},
	
		/**
		 * Triggered when the value of the control has been changed.
		 * This should propagate the event to the original DOM
		 * input / select element.
		 */
		onChange: function() {
			this.$input.trigger('change');
		},
	
		/**
		 * Triggered on <input> keypress.
		 *
		 * @param {object} e
		 * @returns {boolean}
		 */
		onKeyPress: function(e) {
			if (this.isLocked) return e && e.preventDefault();
			var character = String.fromCharCode(e.keyCode || e.which);
			if (this.settings.create && character === this.settings.delimiter) {
				this.createItem();
				e.preventDefault();
				return false;
			}
		},
	
		/**
		 * Triggered on <input> keydown.
		 *
		 * @param {object} e
		 * @returns {boolean}
		 */
		onKeyDown: function(e) {
			var isInput = e.target === this.$control_input[0];
			var self = this;
	
			if (self.isLocked) {
				if (e.keyCode !== KEY_TAB) {
					e.preventDefault();
				}
				return;
			}
	
			switch (e.keyCode) {
				case KEY_A:
					if (self.isCmdDown) {
						self.selectAll();
						return;
					}
					break;
				case KEY_ESC:
					self.blur();
					return;
				case KEY_DOWN:
					if (!self.isOpen && self.hasOptions) {
						self.open();
					} else if (self.$activeOption) {
						self.ignoreHover = true;
						var $next = self.getAdjacentOption(self.$activeOption, 1);
						if ($next.length) self.setActiveOption($next, true, true);
					}
					e.preventDefault();
					return;
				case KEY_UP:
					if (self.$activeOption) {
						self.ignoreHover = true;
						var $prev = self.getAdjacentOption(self.$activeOption, -1);
						if ($prev.length) self.setActiveOption($prev, true, true);
					}
					e.preventDefault();
					return;
				case KEY_RETURN:
					if (self.$activeOption) {
						self.onOptionSelect({currentTarget: self.$activeOption});
					}
					e.preventDefault();
					return;
				case KEY_LEFT:
					self.advanceSelection(-1, e);
					return;
				case KEY_RIGHT:
					self.advanceSelection(1, e);
					return;
				case KEY_TAB:
					if (self.settings.create && $.trim(self.$control_input.val()).length) {
						self.createItem();
						e.preventDefault();
					}
					return;
				case KEY_BACKSPACE:
				case KEY_DELETE:
					self.deleteSelection(e);
					return;
			}
			if (self.isFull() || self.isInputHidden) {
				e.preventDefault();
				return;
			}
		},
	
		/**
		 * Triggered on <input> keyup.
		 *
		 * @param {object} e
		 * @returns {boolean}
		 */
		onKeyUp: function(e) {
			var self = this;
	
			if (self.isLocked) return e && e.preventDefault();
			var value = self.$control_input.val() || '';
			if (self.lastValue !== value) {
				self.lastValue = value;
				self.onSearchChange(value);
				self.refreshOptions();
				self.trigger('type', value);
			}
		},
	
		/**
		 * Invokes the user-provide option provider / loader.
		 *
		 * Note: this function is debounced in the Selectize
		 * constructor (by `settings.loadDelay` milliseconds)
		 *
		 * @param {string} value
		 */
		onSearchChange: function(value) {
			var self = this;
			var fn = self.settings.load;
			if (!fn) return;
			if (self.loadedSearches.hasOwnProperty(value)) return;
			self.loadedSearches[value] = true;
			self.load(function(callback) {
				fn.apply(self, [value, callback]);
			});
		},
	
		/**
		 * Triggered on <input> focus.
		 *
		 * @param {object} e (optional)
		 * @returns {boolean}
		 */
		onFocus: function(e) {
			var self = this;
	
			self.isInputFocused = true;
			self.isFocused = true;
			if (self.isDisabled) {
				self.blur();
				e.preventDefault();
				return false;
			}
	
			if (self.ignoreFocus) return;
			if (self.settings.preload === 'focus') self.onSearchChange('');
	
			self.showInput();
			self.setActiveItem(null);
			self.refreshOptions(!!self.settings.openOnFocus);
			self.refreshClasses();
		},
	
		/**
		 * Triggered on <input> blur.
		 *
		 * @param {object} e
		 * @returns {boolean}
		 */
		onBlur: function(e) {
			var self = this;
			self.isInputFocused = false;
			if (self.ignoreFocus) return;
	
			self.close();
			self.setTextboxValue('');
			self.setActiveItem(null);
			self.setActiveOption(null);
			self.setCaret(self.items.length);
			self.isFocused = false;
			self.refreshClasses();
		},
	
		/**
		 * Triggered when the user rolls over
		 * an option in the autocomplete dropdown menu.
		 *
		 * @param {object} e
		 * @returns {boolean}
		 */
		onOptionHover: function(e) {
			if (this.ignoreHover) return;
			this.setActiveOption(e.currentTarget, false);
		},
	
		/**
		 * Triggered when the user clicks on an option
		 * in the autocomplete dropdown menu.
		 *
		 * @param {object} e
		 * @returns {boolean}
		 */
		onOptionSelect: function(e) {
			var value, $target, $option, self = this;
	
			e.preventDefault && e.preventDefault();
			e.stopPropagation && e.stopPropagation();
			self.focus(false);
	
			$target = $(e.currentTarget);
			if ($target.hasClass('create')) {
				self.createItem();
			} else {
				value = $target.attr('data-value');
				if (value) {
					self.setTextboxValue('');
					self.addItem(value);
					if (!self.settings.hideSelected && e.type && /mouse/.test(e.type)) {
						self.setActiveOption(self.getOption(value));
					}
				}
			}
		},
	
		/**
		 * Triggered when the user clicks on an item
		 * that has been selected.
		 *
		 * @param {object} e
		 * @returns {boolean}
		 */
		onItemSelect: function(e) {
			var self = this;
	
			if (self.settings.mode === 'multi') {
				e.preventDefault();
				self.setActiveItem(e.currentTarget, e);
				self.focus(false);
				self.hideInput();
			}
		},
	
		/**
		 * Invokes the provided method that provides
		 * results to a callback---which are then added
		 * as options to the control.
		 *
		 * @param {function} fn
		 */
		load: function(fn) {
			var self = this;
			var $wrapper = self.$wrapper.addClass('loading');
	
			self.loading++;
			fn.apply(self, [function(results) {
				self.loading = Math.max(self.loading - 1, 0);
				if (results && results.length) {
					self.addOption(results);
					self.refreshOptions(false);
					if (self.isInputFocused) self.open();
				}
				if (!self.loading) {
					$wrapper.removeClass('loading');
				}
				self.trigger('load', results);
			}]);
		},
	
		/**
		 * Sets the input field of the control to the specified value.
		 *
		 * @param {string} value
		 */
		setTextboxValue: function(value) {
			this.$control_input.val(value).triggerHandler('update');
			this.lastValue = value;
		},
	
		/**
		 * Returns the value of the control. If multiple items
		 * can be selected (e.g. <select multiple>), this returns
		 * an array. If only one item can be selected, this
		 * returns a string.
		 *
		 * @returns {mixed}
		 */
		getValue: function() {
			if (this.tagType === TAG_SELECT && this.$input.attr('multiple')) {
				return this.items;
			} else {
				return this.items.join(this.settings.delimiter);
			}
		},
	
		/**
		 * Resets the selected items to the given value.
		 *
		 * @param {mixed} value
		 */
		setValue: function(value) {
			debounce_events(this, ['change'], function() {
				this.clear();
				var items = $.isArray(value) ? value : [value];
				for (var i = 0, n = items.length; i < n; i++) {
					this.addItem(items[i]);
				}
			});
		},
	
		/**
		 * Sets the selected item.
		 *
		 * @param {object} $item
		 * @param {object} e (optional)
		 */
		setActiveItem: function($item, e) {
			var self = this;
			var eventName;
			var i, idx, begin, end, item, swap;
			var $last;
	
			$item = $($item);
	
			// clear the active selection
			if (!$item.length) {
				$(self.$activeItems).removeClass('active');
				self.$activeItems = [];
				self.isFocused = self.isInputFocused;
				return;
			}
	
			// modify selection
			eventName = e && e.type.toLowerCase();
	
			if (eventName === 'mousedown' && self.isShiftDown && self.$activeItems.length) {
				$last = self.$control.children('.active:last');
				begin = Array.prototype.indexOf.apply(self.$control[0].childNodes, [$last[0]]);
				end   = Array.prototype.indexOf.apply(self.$control[0].childNodes, [$item[0]]);
				if (begin > end) {
					swap  = begin;
					begin = end;
					end   = swap;
				}
				for (i = begin; i <= end; i++) {
					item = self.$control[0].childNodes[i];
					if (self.$activeItems.indexOf(item) === -1) {
						$(item).addClass('active');
						self.$activeItems.push(item);
					}
				}
				e.preventDefault();
			} else if ((eventName === 'mousedown' && self.isCtrlDown) || (eventName === 'keydown' && this.isShiftDown)) {
				if ($item.hasClass('active')) {
					idx = self.$activeItems.indexOf($item[0]);
					self.$activeItems.splice(idx, 1);
					$item.removeClass('active');
				} else {
					self.$activeItems.push($item.addClass('active')[0]);
				}
			} else {
				$(self.$activeItems).removeClass('active');
				self.$activeItems = [$item.addClass('active')[0]];
			}
	
			self.isFocused = !!self.$activeItems.length || self.isInputFocused;
		},
	
		/**
		 * Sets the selected item in the dropdown menu
		 * of available options.
		 *
		 * @param {object} $object
		 * @param {boolean} scroll
		 * @param {boolean} animate
		 */
		setActiveOption: function($option, scroll, animate) {
			var height_menu, height_item, y;
			var scroll_top, scroll_bottom;
			var self = this;
	
			if (self.$activeOption) self.$activeOption.removeClass('active');
			self.$activeOption = null;
	
			$option = $($option);
			if (!$option.length) return;
	
			self.$activeOption = $option.addClass('active');
	
			if (scroll || !isset(scroll)) {
	
				height_menu   = self.$dropdown_content.height();
				height_item   = self.$activeOption.outerHeight(true);
				scroll        = self.$dropdown_content.scrollTop() || 0;
				y             = self.$activeOption.offset().top - self.$dropdown_content.offset().top + scroll;
				scroll_top    = y;
				scroll_bottom = y - height_menu + height_item;
	
				if (y + height_item > height_menu - scroll) {
					self.$dropdown_content.stop().animate({scrollTop: scroll_bottom}, animate ? self.settings.scrollDuration : 0);
				} else if (y < scroll) {
					self.$dropdown_content.stop().animate({scrollTop: scroll_top}, animate ? self.settings.scrollDuration : 0);
				}
	
			}
		},
	
		/**
		 * Selects all items (CTRL + A).
		 */
		selectAll: function() {
			this.$activeItems = Array.prototype.slice.apply(this.$control.children(':not(input)').addClass('active'));
			this.isFocused = true;
			if (this.$activeItems.length) this.hideInput();
		},
	
		/**
		 * Hides the input element out of view, while
		 * retaining its focus.
		 */
		hideInput: function() {
			var self = this;
	
			self.close();
			self.setTextboxValue('');
			self.$control_input.css({opacity: 0, position: 'absolute', left: -10000});
			self.isInputHidden = true;
		},
	
		/**
		 * Restores input visibility.
		 */
		showInput: function() {
			this.$control_input.css({opacity: 1, position: 'relative', left: 0});
			this.isInputHidden = false;
		},
	
		/**
		 * Gives the control focus. If "trigger" is falsy,
		 * focus handlers won't be fired--causing the focus
		 * to happen silently in the background.
		 *
		 * @param {boolean} trigger
		 */
		focus: function(trigger) {
			var self = this;
	
			if (self.isDisabled) return;
			self.ignoreFocus = true;
			self.$control_input[0].focus();
			self.isInputFocused = true;
			window.setTimeout(function() {
				self.ignoreFocus = false;
				if (trigger) self.onFocus();
			}, 0);
		},
	
		/**
		 * Forces the control out of focus.
		 */
		blur: function() {
			this.$control_input.trigger('blur');
		},
	
		/**
		 * Returns a function that scores an object
		 * to show how good of a match it is to the
		 * provided query.
		 *
		 * @param {string} query
		 * @param {object} options
		 * @return {function}
		 */
		getScoreFunction: function(query) {
			return this.sifter.getScoreFunction(query, this.getSearchOptions());
		},
	
		/**
		 * Returns search options for sifter (the system
		 * for scoring and sorting results).
		 *
		 * @see https://github.com/brianreavis/sifter.js
		 * @return {object}
		 */
		getSearchOptions: function() {
			var settings = this.settings;
			var fields = settings.searchField;
	
			return {
				fields    : $.isArray(fields) ? fields : [fields],
				sort      : settings.sortField,
				direction : settings.sortDirection,
			};
		},
	
		/**
		 * Searches through available options and returns
		 * a sorted array of matches.
		 *
		 * Returns an object containing:
		 *
		 *   - query {string}
		 *   - tokens {array}
		 *   - total {int}
		 *   - items {array}
		 *
		 * @param {string} query
		 * @returns {object}
		 */
		search: function(query) {
			var i, value, score, result, calculateScore;
			var self     = this;
			var settings = self.settings;
			var options  = this.getSearchOptions();
	
			// validate user-provided result scoring function
			if (settings.score) {
				calculateScore = self.settings.score.apply(this, [query]);
				if (typeof calculateScore !== 'function') {
					throw new Error('Selectize "score" setting must be a function that returns a function');
				}
			}
	
			// perform search
			if (query !== self.lastQuery) {
				self.lastQuery = query;
				result = self.sifter.search(query, $.extend(options, {score: calculateScore}));
				self.currentResults = result;
			} else {
				result = $.extend(true, {}, self.currentResults);
			}
	
			// filter out selected items
			if (settings.hideSelected) {
				for (i = result.items.length - 1; i >= 0; i--) {
					if (self.items.indexOf(hash_key(result.items[i].id)) !== -1) {
						result.items.splice(i, 1);
					}
				}
			}
	
			return result;
		},
	
		/**
		 * Refreshes the list of available options shown
		 * in the autocomplete dropdown menu.
		 *
		 * @param {boolean} triggerDropdown
		 */
		refreshOptions: function(triggerDropdown) {
			if (typeof triggerDropdown === 'undefined') {
				triggerDropdown = true;
			}
	
			var self = this;
			var i, n, groups, groups_order, option, optgroup, html, html_children;
			var hasCreateOption;
			var query = self.$control_input.val();
			var results = self.search(query);
			var $active, $create;
			var $dropdown_content = self.$dropdown_content;
	
			// build markup
			n = results.items.length;
			if (typeof self.settings.maxOptions === 'number') {
				n = Math.min(n, self.settings.maxOptions);
			}
	
			// render and group available options individually
			groups = {};
	
			if (self.settings.optgroupOrder) {
				groups_order = self.settings.optgroupOrder;
				for (i = 0; i < groups_order.length; i++) {
					groups[groups_order[i]] = [];
				}
			} else {
				groups_order = [];
			}
	
			for (i = 0; i < n; i++) {
				option = self.options[results.items[i].id];
				optgroup = option[self.settings.optgroupField] || '';
				if (!self.optgroups.hasOwnProperty(optgroup)) {
					optgroup = '';
				}
				if (!groups.hasOwnProperty(optgroup)) {
					groups[optgroup] = [];
					groups_order.push(optgroup);
				}
				groups[optgroup].push(self.render('option', option));
			}
	
			// render optgroup headers & join groups
			html = [];
			for (i = 0, n = groups_order.length; i < n; i++) {
				optgroup = groups_order[i];
				if (self.optgroups.hasOwnProperty(optgroup) && groups[optgroup].length) {
					// render the optgroup header and options within it,
					// then pass it to the wrapper template
					html_children = self.render('optgroup_header', self.optgroups[optgroup]) || '';
					html_children += groups[optgroup].join('');
					html.push(self.render('optgroup', $.extend({}, self.optgroups[optgroup], {
						html: html_children
					})));
				} else {
					html.push(groups[optgroup].join(''));
				}
			}
	
			$dropdown_content.html(html.join(''));
	
			// highlight matching terms inline
			if (self.settings.highlight && results.query.length && results.tokens.length) {
				for (i = 0, n = results.tokens.length; i < n; i++) {
					highlight($dropdown_content, results.tokens[i].regex);
				}
			}
	
			// add "selected" class to selected options
			if (!self.settings.hideSelected) {
				for (i = 0, n = self.items.length; i < n; i++) {
					self.getOption(self.items[i]).addClass('selected');
				}
			}
	
			// add create option
			hasCreateOption = self.settings.create && results.query.length;
			if (hasCreateOption) {
				$dropdown_content.prepend(self.render('option_create', {input: query}));
				$create = $($dropdown_content[0].childNodes[0]);
			}
	
			// activate
			self.hasOptions = results.items.length > 0 || hasCreateOption;
			if (self.hasOptions) {
				if (results.items.length > 0) {
					if ($create) {
						$active = self.getAdjacentOption($create, 1);
					} else {
						$active = $dropdown_content.find("[data-selectable]").first();
					}
				} else {
					$active = $create;
				}
				self.setActiveOption($active);
				if (triggerDropdown && !self.isOpen) { self.open(); }
			} else {
				self.setActiveOption(null);
				if (triggerDropdown && self.isOpen) { self.close(); }
			}
		},
	
		/**
		 * Adds an available option. If it already exists,
		 * nothing will happen. Note: this does not refresh
		 * the options list dropdown (use `refreshOptions`
		 * for that).
		 *
		 * Usage:
		 *
		 *   this.addOption(data)
		 *
		 * @param {object} data
		 */
		addOption: function(data) {
			var i, n, optgroup, value, self = this;
	
			if ($.isArray(data)) {
				for (i = 0, n = data.length; i < n; i++) {
					self.addOption(data[i]);
				}
				return;
			}
	
			value = hash_key(data[self.settings.valueField]);
			if (!value || self.options.hasOwnProperty(value)) return;
	
			self.userOptions[value] = true;
			self.options[value] = data;
			self.lastQuery = null;
			self.trigger('option_add', value, data);
		},
	
		/**
		 * Registers a new optgroup for options
		 * to be bucketed into.
		 *
		 * @param {string} id
		 * @param {object} data
		 */
		addOptionGroup: function(id, data) {
			this.optgroups[id] = data;
			this.trigger('optgroup_add', id, data);
		},
	
		/**
		 * Updates an option available for selection. If
		 * it is visible in the selected items or options
		 * dropdown, it will be re-rendered automatically.
		 *
		 * @param {string} value
		 * @param {object} data
		 */
		updateOption: function(value, data) {
			var self = this;
			var $item, $item_new;
			var value_new, index_item, cache_items, cache_options;
	
			value     = hash_key(value);
			value_new = hash_key(data[self.settings.valueField]);
	
			// sanity checks
			if (!self.options.hasOwnProperty(value)) return;
			if (!value_new) throw new Error('Value must be set in option data');
	
			// update references
			if (value_new !== value) {
				delete self.options[value];
				index_item = self.items.indexOf(value);
				if (index_item !== -1) {
					self.items.splice(index_item, 1, value_new);
				}
			}
			self.options[value_new] = data;
	
			// invalidate render cache
			cache_items = self.renderCache['item'];
			cache_options = self.renderCache['option'];
	
			if (isset(cache_items)) {
				delete cache_items[value];
				delete cache_items[value_new];
			}
			if (isset(cache_options)) {
				delete cache_options[value];
				delete cache_options[value_new];
			}
	
			// update the item if it's selected
			if (self.items.indexOf(value_new) !== -1) {
				$item = self.getItem(value);
				$item_new = $(self.render('item', data));
				if ($item.hasClass('active')) $item_new.addClass('active');
				$item.replaceWith($item_new);
			}
	
			// update dropdown contents
			if (self.isOpen) {
				self.refreshOptions(false);
			}
		},
	
		/**
		 * Removes a single option.
		 *
		 * @param {string} value
		 */
		removeOption: function(value) {
			var self = this;
	
			value = hash_key(value);
			delete self.userOptions[value];
			delete self.options[value];
			self.lastQuery = null;
			self.trigger('option_remove', value);
			self.removeItem(value);
		},
	
		/**
		 * Clears all options.
		 */
		clearOptions: function() {
			var self = this;
	
			self.loadedSearches = {};
			self.userOptions = {};
			self.options = self.sifter.items = {};
			self.lastQuery = null;
			self.trigger('option_clear');
			self.clear();
		},
	
		/**
		 * Returns the jQuery element of the option
		 * matching the given value.
		 *
		 * @param {string} value
		 * @returns {object}
		 */
		getOption: function(value) {
			return this.getElementWithValue(value, this.$dropdown_content.find('[data-selectable]'));
		},
	
		/**
		 * Returns the jQuery element of the next or
		 * previous selectable option.
		 *
		 * @param {object} $option
		 * @param {int} direction  can be 1 for next or -1 for previous
		 * @return {object}
		 */
		getAdjacentOption: function($option, direction) {
			var $options = this.$dropdown.find('[data-selectable]');
			var index    = $options.index($option) + direction;
	
			return index >= 0 && index < $options.length ? $options.eq(index) : $();
		},
	
		/**
		 * Finds the first element with a "data-value" attribute
		 * that matches the given value.
		 *
		 * @param {mixed} value
		 * @param {object} $els
		 * @return {object}
		 */
		getElementWithValue: function(value, $els) {
			value = hash_key(value);
	
			if (value) {
				for (var i = 0, n = $els.length; i < n; i++) {
					if ($els[i].getAttribute('data-value') === value) {
						return $($els[i]);
					}
				}
			}
	
			return $();
		},
	
		/**
		 * Returns the jQuery element of the item
		 * matching the given value.
		 *
		 * @param {string} value
		 * @returns {object}
		 */
		getItem: function(value) {
			return this.getElementWithValue(value, this.$control.children());
		},
	
		/**
		 * "Selects" an item. Adds it to the list
		 * at the current caret position.
		 *
		 * @param {string} value
		 */
		addItem: function(value) {
			debounce_events(this, ['change'], function() {
				var $item, $option;
				var self = this;
				var inputMode = self.settings.mode;
				var i, active, options, value_next;
				value = hash_key(value);
	
				if (inputMode === 'single') self.clear();
				if (inputMode === 'multi' && self.isFull()) return;
				if (self.items.indexOf(value) !== -1) return;
				if (!self.options.hasOwnProperty(value)) return;
	
				$item = $(self.render('item', self.options[value]));
				self.items.splice(self.caretPos, 0, value);
				self.insertAtCaret($item);
				self.refreshClasses();
	
				if (self.isSetup) {
					options = self.$dropdown_content.find('[data-selectable]');
	
					// update menu / remove the option
					$option = self.getOption(value);
					value_next = self.getAdjacentOption($option, 1).attr('data-value');
					self.refreshOptions(self.isFocused && inputMode !== 'single');
					if (value_next) {
						self.setActiveOption(self.getOption(value_next));
					}
	
					// hide the menu if the maximum number of items have been selected or no options are left
					if (!options.length || (self.settings.maxItems !== null && self.items.length >= self.settings.maxItems)) {
						self.close();
					} else {
						self.positionDropdown();
					}
	
					// restore focus to input
					if (self.isFocused) {
						window.setTimeout(function() {
							if (inputMode === 'single') {
								self.blur();
								self.focus(false);
								self.hideInput();
							} else {
								self.focus(false);
							}
						}, 0);
					}
	
					self.updatePlaceholder();
					self.trigger('item_add', value, $item);
					self.updateOriginalInput();
				}
			});
		},
	
		/**
		 * Removes the selected item matching
		 * the provided value.
		 *
		 * @param {string} value
		 */
		removeItem: function(value) {
			var self = this;
			var $item, i, idx;
	
			$item = (typeof value === 'object') ? value : self.getItem(value);
			value = hash_key($item.attr('data-value'));
			i = self.items.indexOf(value);
	
			if (i !== -1) {
				$item.remove();
				if ($item.hasClass('active')) {
					idx = self.$activeItems.indexOf($item[0]);
					self.$activeItems.splice(idx, 1);
				}
	
				self.items.splice(i, 1);
				self.lastQuery = null;
				if (!self.settings.persist && self.userOptions.hasOwnProperty(value)) {
					self.removeOption(value);
				}
	
				if (i < self.caretPos) {
					self.setCaret(self.caretPos - 1);
				}
	
				self.refreshClasses();
				self.updatePlaceholder();
				self.updateOriginalInput();
				self.positionDropdown();
				self.trigger('item_remove', value);
			}
		},
	
		/**
		 * Invokes the `create` method provided in the
		 * selectize options that should provide the data
		 * for the new item, given the user input.
		 *
		 * Once this completes, it will be added
		 * to the item list.
		 */
		createItem: function() {
			var self  = this;
			var input = $.trim(self.$control_input.val() || '');
			var caret = self.caretPos;
			if (!input.length) return;
			self.lock();
	
			var setup = (typeof self.settings.create === 'function') ? this.settings.create : function(input) {
				var data = {};
				data[self.settings.labelField] = input;
				data[self.settings.valueField] = input;
				return data;
			};
	
			var create = once(function(data) {
				self.unlock();
				self.focus(false);
	
				if (!data || typeof data !== 'object') return;
				var value = hash_key(data[self.settings.valueField]);
				if (!value) return;
	
				self.setTextboxValue('');
				self.addOption(data);
				self.setCaret(caret);
				self.addItem(value);
				self.refreshOptions(self.settings.mode !== 'single');
				self.focus(false);
			});
	
			var output = setup.apply(this, [input, create]);
			if (typeof output !== 'undefined') {
				create(output);
			}
		},
	
		/**
		 * Re-renders the selected item lists.
		 */
		refreshItems: function() {
			this.lastQuery = null;
	
			if (this.isSetup) {
				for (var i = 0; i < this.items.length; i++) {
					this.addItem(this.items);
				}
			}
	
			this.refreshClasses();
			this.updateOriginalInput();
		},
	
		/**
		 * Updates all state-dependent CSS classes.
		 */
		refreshClasses: function() {
			var self = this;
			var isFull = self.isFull();
			var isLocked = self.isLocked;
			this.$control
				.toggleClass('focus', self.isFocused)
				.toggleClass('disabled', self.isDisabled)
				.toggleClass('locked', isLocked)
				.toggleClass('full', isFull).toggleClass('not-full', !isFull)
				.toggleClass('dropdown-active', self.isOpen)
				.toggleClass('has-options', !$.isEmptyObject(self.options))
				.toggleClass('has-items', self.items.length > 0);
			this.$control_input.data('grow', !isFull && !isLocked);
		},
	
		/**
		 * Determines whether or not more items can be added
		 * to the control without exceeding the user-defined maximum.
		 *
		 * @returns {boolean}
		 */
		isFull: function() {
			return this.settings.maxItems !== null && this.items.length >= this.settings.maxItems;
		},
	
		/**
		 * Refreshes the original <select> or <input>
		 * element to reflect the current state.
		 */
		updateOriginalInput: function() {
			var i, n, options, self = this;
	
			if (self.$input[0].tagName.toLowerCase() === 'select') {
				options = [];
				for (i = 0, n = self.items.length; i < n; i++) {
					options.push('<option value="' + escape_html(self.items[i]) + '" selected="selected"></option>');
				}
				if (!options.length && !this.$input.attr('multiple')) {
					options.push('<option value="" selected="selected"></option>');
				}
				self.$input.html(options.join(''));
			} else {
				self.$input.val(self.getValue());
			}
	
			if (self.isSetup) {
				self.trigger('change', self.$input.val());
			}
		},
	
		/**
		 * Shows/hide the input placeholder depending
		 * on if there items in the list already.
		 */
		updatePlaceholder: function() {
			if (!this.settings.placeholder) return;
			var $input = this.$control_input;
	
			if (this.items.length) {
				$input.removeAttr('placeholder');
			} else {
				$input.attr('placeholder', this.settings.placeholder);
			}
			$input.triggerHandler('update');
		},
	
		/**
		 * Shows the autocomplete dropdown containing
		 * the available options.
		 */
		open: function() {
			var self = this;
	
			if (self.isLocked || self.isOpen || (self.settings.mode === 'multi' && self.isFull())) return;
			self.focus(true);
			self.isOpen = true;
			self.refreshClasses();
			self.$dropdown.css({visibility: 'hidden', display: 'block'});
			self.positionDropdown();
			self.$dropdown.css({visibility: 'visible'});
			self.trigger('dropdown_open', this.$dropdown);
		},
	
		/**
		 * Closes the autocomplete dropdown menu.
		 */
		close: function() {
			var self = this;
	
			if (!self.isOpen) return;
			self.$dropdown.hide();
			self.setActiveOption(null);
			self.isOpen = false;
			self.refreshClasses();
			self.trigger('dropdown_close', self.$dropdown);
		},
	
		/**
		 * Calculates and applies the appropriate
		 * position of the dropdown.
		 */
		positionDropdown: function() {
			var $control = this.$control;
			var offset = this.settings.dropdownParent === 'body' ? $control.offset() : $control.position();
			offset.top += $control.outerHeight(true);
	
			this.$dropdown.css({
				width : $control.outerWidth(),
				top   : offset.top,
				left  : offset.left
			});
		},
	
		/**
		 * Resets / clears all selected items
		 * from the control.
		 */
		clear: function() {
			var self = this;
	
			if (!self.items.length) return;
			self.$control.children(':not(input)').remove();
			self.items = [];
			self.setCaret(0);
			self.updatePlaceholder();
			self.updateOriginalInput();
			self.refreshClasses();
			self.showInput();
			self.trigger('clear');
		},
	
		/**
		 * A helper method for inserting an element
		 * at the current caret position.
		 *
		 * @param {object} $el
		 */
		insertAtCaret: function($el) {
			var caret = Math.min(this.caretPos, this.items.length);
			if (caret === 0) {
				this.$control.prepend($el);
			} else {
				$(this.$control[0].childNodes[caret]).before($el);
			}
			this.setCaret(caret + 1);
		},
	
		/**
		 * Removes the current selected item(s).
		 *
		 * @param {object} e (optional)
		 * @returns {boolean}
		 */
		deleteSelection: function(e) {
			var i, n, direction, selection, values, caret, option_select, $option_select, $tail;
			var self = this;
	
			direction = (e && e.keyCode === KEY_BACKSPACE) ? -1 : 1;
			selection = getSelection(self.$control_input[0]);
	
			if (self.$activeOption && !self.settings.hideSelected) {
				option_select = self.getAdjacentOption(self.$activeOption, -1).attr('data-value');
			}
	
			// determine items that will be removed
			values = [];
	
			if (self.$activeItems.length) {
				$tail = self.$control.children('.active:' + (direction > 0 ? 'last' : 'first'));
				caret = self.$control.children(':not(input)').index($tail);
				if (direction > 0) { caret++; }
	
				for (i = 0, n = self.$activeItems.length; i < n; i++) {
					values.push($(self.$activeItems[i]).attr('data-value'));
				}
				if (e) {
					e.preventDefault();
					e.stopPropagation();
				}
			} else if ((self.isFocused || self.settings.mode === 'single') && self.items.length) {
				if (direction < 0 && selection.start === 0 && selection.length === 0) {
					values.push(self.items[self.caretPos - 1]);
				} else if (direction > 0 && selection.start === self.$control_input.val().length) {
					values.push(self.items[self.caretPos]);
				}
			}
	
			// allow the callback to abort
			if (!values.length || (typeof self.settings.onDelete === 'function' && self.settings.onDelete.apply(self, [values]) === false)) {
				return false;
			}
	
			// perform removal
			if (typeof caret !== 'undefined') {
				self.setCaret(caret);
			}
			while (values.length) {
				self.removeItem(values.pop());
			}
	
			self.showInput();
			self.refreshOptions(true);
	
			// select previous option
			if (option_select) {
				$option_select = self.getOption(option_select);
				if ($option_select.length) {
					self.setActiveOption($option_select);
				}
			}
	
			return true;
		},
	
		/**
		 * Selects the previous / next item (depending
		 * on the `direction` argument).
		 *
		 * > 0 - right
		 * < 0 - left
		 *
		 * @param {int} direction
		 * @param {object} e (optional)
		 */
		advanceSelection: function(direction, e) {
			var tail, selection, idx, valueLength, cursorAtEdge, $tail;
			var self = this;
	
			if (direction === 0) return;
	
			tail = direction > 0 ? 'last' : 'first';
			selection = getSelection(self.$control_input[0]);
	
			if (self.isInputFocused && !self.isInputHidden) {
				valueLength = self.$control_input.val().length;
				cursorAtEdge = direction < 0
					? selection.start === 0 && selection.length === 0
					: selection.start === valueLength;
	
				if (cursorAtEdge && !valueLength) {
					self.advanceCaret(direction, e);
				}
			} else {
				$tail = self.$control.children('.active:' + tail);
				if ($tail.length) {
					idx = self.$control.children(':not(input)').index($tail);
					self.setActiveItem(null);
					self.setCaret(direction > 0 ? idx + 1 : idx);
					self.showInput();
				}
			}
		},
	
		/**
		 * Moves the caret left / right.
		 *
		 * @param {int} direction
		 * @param {object} e (optional)
		 */
		advanceCaret: function(direction, e) {
			if (direction === 0) return;
			var self = this;
			var fn = direction > 0 ? 'next' : 'prev';
			if (self.isShiftDown) {
				var $adj = self.$control_input[fn]();
				if ($adj.length) {
					self.hideInput();
					self.setActiveItem($adj);
					e && e.preventDefault();
				}
			} else {
				self.setCaret(self.caretPos + direction);
			}
		},
	
		/**
		 * Moves the caret to the specified index.
		 *
		 * @param {int} i
		 */
		setCaret: function(i) {
			var self = this;
	
			if (self.settings.mode === 'single') {
				i = self.items.length;
			} else {
				i = Math.max(0, Math.min(self.items.length, i));
			}
	
			// the input must be moved by leaving it in place and moving the
			// siblings, due to the fact that focus cannot be restored once lost
			// on mobile webkit devices
			var j, n, fn, $children, $child;
			$children = self.$control.children(':not(input)');
			for (j = 0, n = $children.length; j < n; j++) {
				$child = $($children[j]).detach();
				if (j <  i) {
					self.$control_input.before($child);
				} else {
					self.$control.append($child);
				}
			}
	
			self.caretPos = i;
		},
	
		/**
		 * Disables user input on the control. Used while
		 * items are being asynchronously created.
		 */
		lock: function() {
			this.close();
			this.isLocked = true;
			this.refreshClasses();
		},
	
		/**
		 * Re-enables user input on the control.
		 */
		unlock: function() {
			this.isLocked = false;
			this.refreshClasses();
		},
	
		/**
		 * Disables user input on the control completely.
		 * While disabled, it cannot receive focus.
		 */
		disable: function() {
			var self = this;
			self.$input.prop('disabled', true);
			self.isDisabled = true;
			self.lock();
		},
	
		/**
		 * Enables the control so that it can respond
		 * to focus and user input.
		 */
		enable: function() {
			var self = this;
			self.$input.prop('disabled', false);
			self.isDisabled = false;
			self.unlock();
		},
	
		/**
		 * Completely destroys the control and
		 * unbinds all event listeners so that it can
		 * be garbage collected.
		 */
		destroy: function() {
			var self = this;
			var eventNS = self.eventNS;
	
			self.trigger('destroy');
			self.off();
			self.$wrapper.remove();
			self.$dropdown.remove();
			self.$input.show();
	
			$(window).off(eventNS);
			$(document).off(eventNS);
			$(document.body).off(eventNS);
	
			delete self.$input[0].selectize;
		},
	
		/**
		 * A helper method for rendering "item" and
		 * "option" templates, given the data.
		 *
		 * @param {string} templateName
		 * @param {object} data
		 * @returns {string}
		 */
		render: function(templateName, data) {
			var value, id, label;
			var html = '';
			var cache = false;
			var self = this;
			var regex_tag = /^[\t ]*<([a-z][a-z0-9\-_]*(?:\:[a-z][a-z0-9\-_]*)?)/i;
	
			if (templateName === 'option' || templateName === 'item') {
				value = hash_key(data[self.settings.valueField]);
				cache = !!value;
			}
	
			// pull markup from cache if it exists
			if (cache) {
				if (!isset(self.renderCache[templateName])) {
					self.renderCache[templateName] = {};
				}
				if (self.renderCache[templateName].hasOwnProperty(value)) {
					return self.renderCache[templateName][value];
				}
			}
	
			// render markup
			html = self.settings.render[templateName].apply(this, [data, escape_html]);
	
			// add mandatory attributes
			if (templateName === 'option' || templateName === 'option_create') {
				html = html.replace(regex_tag, '<$1 data-selectable');
			}
			if (templateName === 'optgroup') {
				id = data[self.settings.optgroupValueField] || '';
				html = html.replace(regex_tag, '<$1 data-group="' + escape_html(id) + '"');
			}
			if (templateName === 'option' || templateName === 'item') {
				html = html.replace(regex_tag, '<$1 data-value="' + escape_html(value || '') + '"');
			}
	
			// update cache
			if (cache) {
				self.renderCache[templateName][value] = html;
			}
	
			return html;
		}
	
	});
	
	Selectize.count = 0;
	Selectize.defaults = {
		plugins: [],
		delimiter: ',',
		persist: true,
		diacritics: true,
		create: false,
		highlight: true,
		openOnFocus: true,
		maxOptions: 1000,
		maxItems: null,
		hideSelected: null,
		preload: false,
	
		scrollDuration: 60,
		loadThrottle: 300,
	
		dataAttr: 'data-data',
		optgroupField: 'optgroup',
		sortField: '$order',
		sortDirection: 'asc',
		valueField: 'value',
		labelField: 'text',
		optgroupLabelField: 'label',
		optgroupValueField: 'value',
		optgroupOrder: null,
		searchField: ['text'],
	
		mode: null,
		wrapperClass: 'selectize-control',
		inputClass: 'selectize-input',
		dropdownClass: 'selectize-dropdown',
		dropdownContentClass: 'selectize-dropdown-content',
	
		dropdownParent: null,
	
		/*
		load            : null, // function(query, callback) { ... }
		score           : null, // function(search) { ... }
		onInitialize    : null, // function() { ... }
		onChange        : null, // function(value) { ... }
		onItemAdd       : null, // function(value, $item) { ... }
		onItemRemove    : null, // function(value) { ... }
		onClear         : null, // function() { ... }
		onOptionAdd     : null, // function(value, data) { ... }
		onOptionRemove  : null, // function(value) { ... }
		onOptionClear   : null, // function() { ... }
		onDropdownOpen  : null, // function($dropdown) { ... }
		onDropdownClose : null, // function($dropdown) { ... }
		onType          : null, // function(str) { ... }
		onDelete        : null, // function(values) { ... }
		*/
	
		render: {
			/*
			item: null,
			optgroup: null,
			optgroup_header: null,
			option: null,
			option_create: null
			*/
		}
	};
	
	$.fn.selectize = function(settings) {
		settings = settings || {};
	
		var defaults = $.fn.selectize.defaults;
		var dataAttr = settings.dataAttr || defaults.dataAttr;
	
		/**
		 * Initializes selectize from a <input type="text"> element.
		 *
		 * @param {object} $input
		 * @param {object} settings
		 */
		var init_textbox = function($input, settings_element) {
			var i, n, values, value = $.trim($input.val() || '');
			if (!value.length) return;
	
			values = value.split(settings.delimiter || defaults.delimiter);
			for (i = 0, n = values.length; i < n; i++) {
				settings_element.options[values[i]] = {
					'text'  : values[i],
					'value' : values[i]
				};
			}
	
			settings_element.items = values;
		};
	
		/**
		 * Initializes selectize from a <select> element.
		 *
		 * @param {object} $input
		 * @param {object} settings
		 */
		var init_select = function($input, settings_element) {
			var i, n, tagName;
			var $children;
			var order = 0;
			settings_element.maxItems = !!$input.attr('multiple') ? null : 1;
	
			var readData = function($el) {
				var data = dataAttr && $el.attr(dataAttr);
				if (typeof data === 'string' && data.length) {
					return JSON.parse(data);
				}
				return null;
			};
	
			var addOption = function($option, group) {
				var value, option;
	
				$option = $($option);
	
				value = $option.attr('value') || '';
				if (!value.length) return;
	
				option = readData($option) || {
					'text'     : $option.text(),
					'value'    : value,
					'optgroup' : group
				};
	
				option.$order = ++order;
				settings_element.options[value] = option;
	
				if ($option.is(':selected')) {
					settings_element.items.push(value);
				}
			};
	
			var addGroup = function($optgroup) {
				var i, n, $options = $('option', $optgroup);
				$optgroup = $($optgroup);
	
				var id = $optgroup.attr('label');
				if (id && id.length) {
					settings_element.optgroups[id] = readData($optgroup) || {
						'label': id
					};
				}
	
				for (i = 0, n = $options.length; i < n; i++) {
					addOption($options[i], id);
				}
			};
	
			$children = $input.children();
			for (i = 0, n = $children.length; i < n; i++) {
				tagName = $children[i].tagName.toLowerCase();
				if (tagName === 'optgroup') {
					addGroup($children[i]);
				} else if (tagName === 'option') {
					addOption($children[i]);
				}
			}
		};
	
		return this.each(function() {
			var instance;
			var $input = $(this);
			var tag_name = $input[0].tagName.toLowerCase();
			var settings_element = {
				'placeholder' : $input.children('option[value=""]').text() || $input.attr('placeholder'),
				'options'     : {},
				'optgroups'   : {},
				'items'       : []
			};
	
			if (tag_name === 'select') {
				init_select($input, settings_element);
			} else {
				init_textbox($input, settings_element);
			}
	
			instance = new Selectize($input, $.extend(true, {}, defaults, settings_element, settings));
			$input.data('selectize', instance);
			$input.addClass('selectized');
		});
	};
	
	$.fn.selectize.defaults = Selectize.defaults;
	
	Selectize.define('drag_drop', function(options) {
		if (!$.fn.sortable) throw new Error('The "drag_drop" plugin requires jQuery UI "sortable".');
		if (this.settings.mode !== 'multi') return;
		var self = this;
	
		this.setup = (function() {
			var original = self.setup;
			return function() {
				original.apply(this, arguments);
	
				var $control = this.$control.sortable({
					items: '[data-value]',
					forcePlaceholderSize: true,
					start: function(e, ui) {
						ui.placeholder.css('width', ui.helper.css('width'));
						$control.css({overflow: 'visible'});
					},
					stop: function() {
						$control.css({overflow: 'hidden'});
						var active = this.$activeItems ? this.$activeItems.slice() : null;
						var values = [];
						$control.children('[data-value]').each(function() {
							values.push($(this).attr('data-value'));
						});
						self.setValue(values);
						self.setActiveItem(active);
					}
				});
			};
		})();
	
	});
	
	Selectize.define('dropdown_header', function(options) {
		var self = this;
	
		options = $.extend({
			title         : 'Untitled',
			headerClass   : 'selectize-dropdown-header',
			titleRowClass : 'selectize-dropdown-header-title',
			labelClass    : 'selectize-dropdown-header-label',
			closeClass    : 'selectize-dropdown-header-close',
	
			html: function(data) {
				return (
					'<div class="' + data.headerClass + '">' +
						'<div class="' + data.titleRowClass + '">' +
							'<span class="' + data.labelClass + '">' + data.title + '</span>' +
							'<a href="javascript:void(0)" class="' + data.closeClass + '">&times;</a>' +
						'</div>' +
					'</div>'
				);
			}
		}, options);
	
		self.setup = (function() {
			var original = self.setup;
			return function() {
				original.apply(self, arguments);
				self.$dropdown_header = $(options.html(options));
				self.$dropdown.prepend(self.$dropdown_header);
			};
		})();
	
	});
	
	Selectize.define('optgroup_columns', function(options) {
		var self = this;
	
		options = $.extend({
			equalizeWidth  : true,
			equalizeHeight : true
		}, options);
	
		this.getAdjacentOption = function($option, direction) {
			var $options = $option.closest('[data-group]').find('[data-selectable]');
			var index    = $options.index($option) + direction;
	
			return index >= 0 && index < $options.length ? $options.eq(index) : $();
		};
	
		this.onKeyDown = (function() {
			var original = self.onKeyDown;
			return function(e) {
				var index, $option, $options, $optgroup;
	
				if (this.isOpen && (e.keyCode === KEY_LEFT || e.keyCode === KEY_RIGHT)) {
					self.ignoreHover = true;
					$optgroup = this.$activeOption.closest('[data-group]');
					index = $optgroup.find('[data-selectable]').index(this.$activeOption);
	
					if(e.keyCode === KEY_LEFT) {
						$optgroup = $optgroup.prev('[data-group]');
					} else {
						$optgroup = $optgroup.next('[data-group]');
					}
	
					$options = $optgroup.find('[data-selectable]');
					$option  = $options.eq(Math.min($options.length - 1, index));
					if ($option.length) {
						this.setActiveOption($option);
					}
					return;
				}
	
				return original.apply(this, arguments);
			};
		})();
	
		var equalizeSizes = function() {
			var i, n, height_max, width, width_last, width_parent, $optgroups;
	
			$optgroups = $('[data-group]', self.$dropdown_content);
			n = $optgroups.length;
			if (!n || !self.$dropdown_content.width()) return;
	
			if (options.equalizeHeight) {
				height_max = 0;
				for (i = 0; i < n; i++) {
					height_max = Math.max(height_max, $optgroups.eq(i).height());
				}
				$optgroups.css({height: height_max});
			}
	
			if (options.equalizeWidth) {
				width_parent = self.$dropdown_content.innerWidth();
				width = Math.round(width_parent / n);
				$optgroups.css({width: width});
				if (n > 1) {
					width_last = width_parent - width * (n - 1);
					$optgroups.eq(n - 1).css({width: width_last});
				}
			}
		};
	
		if (options.equalizeHeight || options.equalizeWidth) {
			hook.after(this, 'positionDropdown', equalizeSizes);
			hook.after(this, 'refreshOptions', equalizeSizes);
		}
	
	
	});
	
	Selectize.define('remove_button', function(options) {
		if (this.settings.mode === 'single') return;
	
		options = $.extend({
			label     : '&times;',
			title     : 'Remove',
			className : 'remove',
			append    : true,
		}, options);
	
		var self = this;
		var html = '<a href="javascript:void(0)" class="' + options.className + '" tabindex="-1" title="' + escape_html(options.title) + '">' + options.label + '</a>';
	
		/**
		 * Appends an element as a child (with raw HTML).
		 *
		 * @param {string} html_container
		 * @param {string} html_element
		 * @return {string}
		 */
		var append = function(html_container, html_element) {
			var pos = html_container.search(/(<\/[^>]+>\s*)$/);
			return html_container.substring(0, pos) + html_element + html_container.substring(pos);
		};
	
		this.setup = (function() {
			var original = self.setup;
			return function() {
				// override the item rendering method to add the button to each
				if (options.append) {
					var render_item = self.settings.render.item;
					self.settings.render.item = function(data) {
						return append(render_item.apply(this, arguments), html);
					};
				}
	
				original.apply(this, arguments);
	
				// add event listener
				this.$control.on('click', '.' + options.className, function(e) {
					e.preventDefault();
					var $item = $(e.target).parent();
					self.setActiveItem($item);
					if (self.deleteSelection()) {
						self.setCaret(self.items.length);
					}
				});
	
			};
		})();
	
	});
	
	Selectize.define('restore_on_backspace', function(options) {
		var self = this;
	
		options.text = options.text || function(option) {
			return option[this.settings.labelField];
		};
	
		this.onKeyDown = (function(e) {
			var original = self.onKeyDown;
			return function(e) {
				var index, option;
				if (e.keyCode === KEY_BACKSPACE && this.$control_input.val() === '' && !this.$activeItems.length) {
					index = this.caretPos - 1;
					if (index >= 0 && index < this.items.length) {
						option = this.options[this.items[index]];
						if (this.deleteSelection(e)) {
							this.setTextboxValue(options.text.apply(this, [option]));
							this.refreshOptions(true);
						}
						e.preventDefault();
						return;
					}
				}
				return original.apply(this, arguments);
			};
		})();
	});

	return Selectize;
}));
//     Underscore.js 1.6.0
//     http://underscorejs.org
//     (c) 2009-2014 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.

(function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `exports` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Establish the object that gets returned to break out of a loop iteration.
  var breaker = {};

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  // Create quick reference variables for speed access to core prototypes.
  var
    push             = ArrayProto.push,
    slice            = ArrayProto.slice,
    concat           = ArrayProto.concat,
    toString         = ObjProto.toString,
    hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeForEach      = ArrayProto.forEach,
    nativeMap          = ArrayProto.map,
    nativeReduce       = ArrayProto.reduce,
    nativeReduceRight  = ArrayProto.reduceRight,
    nativeFilter       = ArrayProto.filter,
    nativeEvery        = ArrayProto.every,
    nativeSome         = ArrayProto.some,
    nativeIndexOf      = ArrayProto.indexOf,
    nativeLastIndexOf  = ArrayProto.lastIndexOf,
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind;

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) {
    if (obj instanceof _) return obj;
    if (!(this instanceof _)) return new _(obj);
    this._wrapped = obj;
  };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object via a string identifier,
  // for Closure Compiler "advanced" mode.
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {
    root._ = _;
  }

  // Current version.
  _.VERSION = '1.6.0';

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles objects with the built-in `forEach`, arrays, and raw objects.
  // Delegates to **ECMAScript 5**'s native `forEach` if available.
  var each = _.each = _.forEach = function(obj, iterator, context) {
    if (obj == null) return obj;
    if (nativeForEach && obj.forEach === nativeForEach) {
      obj.forEach(iterator, context);
    } else if (obj.length === +obj.length) {
      for (var i = 0, length = obj.length; i < length; i++) {
        if (iterator.call(context, obj[i], i, obj) === breaker) return;
      }
    } else {
      var keys = _.keys(obj);
      for (var i = 0, length = keys.length; i < length; i++) {
        if (iterator.call(context, obj[keys[i]], keys[i], obj) === breaker) return;
      }
    }
    return obj;
  };

  // Return the results of applying the iterator to each element.
  // Delegates to **ECMAScript 5**'s native `map` if available.
  _.map = _.collect = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeMap && obj.map === nativeMap) return obj.map(iterator, context);
    each(obj, function(value, index, list) {
      results.push(iterator.call(context, value, index, list));
    });
    return results;
  };

  var reduceError = 'Reduce of empty array with no initial value';

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`. Delegates to **ECMAScript 5**'s native `reduce` if available.
  _.reduce = _.foldl = _.inject = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduce && obj.reduce === nativeReduce) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduce(iterator, memo) : obj.reduce(iterator);
    }
    each(obj, function(value, index, list) {
      if (!initial) {
        memo = value;
        initial = true;
      } else {
        memo = iterator.call(context, memo, value, index, list);
      }
    });
    if (!initial) throw new TypeError(reduceError);
    return memo;
  };

  // The right-associative version of reduce, also known as `foldr`.
  // Delegates to **ECMAScript 5**'s native `reduceRight` if available.
  _.reduceRight = _.foldr = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduceRight && obj.reduceRight === nativeReduceRight) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduceRight(iterator, memo) : obj.reduceRight(iterator);
    }
    var length = obj.length;
    if (length !== +length) {
      var keys = _.keys(obj);
      length = keys.length;
    }
    each(obj, function(value, index, list) {
      index = keys ? keys[--length] : --length;
      if (!initial) {
        memo = obj[index];
        initial = true;
      } else {
        memo = iterator.call(context, memo, obj[index], index, list);
      }
    });
    if (!initial) throw new TypeError(reduceError);
    return memo;
  };

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, predicate, context) {
    var result;
    any(obj, function(value, index, list) {
      if (predicate.call(context, value, index, list)) {
        result = value;
        return true;
      }
    });
    return result;
  };

  // Return all the elements that pass a truth test.
  // Delegates to **ECMAScript 5**'s native `filter` if available.
  // Aliased as `select`.
  _.filter = _.select = function(obj, predicate, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeFilter && obj.filter === nativeFilter) return obj.filter(predicate, context);
    each(obj, function(value, index, list) {
      if (predicate.call(context, value, index, list)) results.push(value);
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, predicate, context) {
    return _.filter(obj, function(value, index, list) {
      return !predicate.call(context, value, index, list);
    }, context);
  };

  // Determine whether all of the elements match a truth test.
  // Delegates to **ECMAScript 5**'s native `every` if available.
  // Aliased as `all`.
  _.every = _.all = function(obj, predicate, context) {
    predicate || (predicate = _.identity);
    var result = true;
    if (obj == null) return result;
    if (nativeEvery && obj.every === nativeEvery) return obj.every(predicate, context);
    each(obj, function(value, index, list) {
      if (!(result = result && predicate.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if at least one element in the object matches a truth test.
  // Delegates to **ECMAScript 5**'s native `some` if available.
  // Aliased as `any`.
  var any = _.some = _.any = function(obj, predicate, context) {
    predicate || (predicate = _.identity);
    var result = false;
    if (obj == null) return result;
    if (nativeSome && obj.some === nativeSome) return obj.some(predicate, context);
    each(obj, function(value, index, list) {
      if (result || (result = predicate.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if the array or object contains a given value (using `===`).
  // Aliased as `include`.
  _.contains = _.include = function(obj, target) {
    if (obj == null) return false;
    if (nativeIndexOf && obj.indexOf === nativeIndexOf) return obj.indexOf(target) != -1;
    return any(obj, function(value) {
      return value === target;
    });
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    var isFunc = _.isFunction(method);
    return _.map(obj, function(value) {
      return (isFunc ? method : value[method]).apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, _.property(key));
  };

  // Convenience version of a common use case of `filter`: selecting only objects
  // containing specific `key:value` pairs.
  _.where = function(obj, attrs) {
    return _.filter(obj, _.matches(attrs));
  };

  // Convenience version of a common use case of `find`: getting the first object
  // containing specific `key:value` pairs.
  _.findWhere = function(obj, attrs) {
    return _.find(obj, _.matches(attrs));
  };

  // Return the maximum element or (element-based computation).
  // Can't optimize arrays of integers longer than 65,535 elements.
  // See [WebKit Bug 80797](https://bugs.webkit.org/show_bug.cgi?id=80797)
  _.max = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0] && obj.length < 65535) {
      return Math.max.apply(Math, obj);
    }
    var result = -Infinity, lastComputed = -Infinity;
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      if (computed > lastComputed) {
        result = value;
        lastComputed = computed;
      }
    });
    return result;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0] && obj.length < 65535) {
      return Math.min.apply(Math, obj);
    }
    var result = Infinity, lastComputed = Infinity;
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      if (computed < lastComputed) {
        result = value;
        lastComputed = computed;
      }
    });
    return result;
  };

  // Shuffle an array, using the modern version of the
  // [Fisher-Yates shuffle](http://en.wikipedia.org/wiki/Fisher–Yates_shuffle).
  _.shuffle = function(obj) {
    var rand;
    var index = 0;
    var shuffled = [];
    each(obj, function(value) {
      rand = _.random(index++);
      shuffled[index - 1] = shuffled[rand];
      shuffled[rand] = value;
    });
    return shuffled;
  };

  // Sample **n** random values from a collection.
  // If **n** is not specified, returns a single random element.
  // The internal `guard` argument allows it to work with `map`.
  _.sample = function(obj, n, guard) {
    if (n == null || guard) {
      if (obj.length !== +obj.length) obj = _.values(obj);
      return obj[_.random(obj.length - 1)];
    }
    return _.shuffle(obj).slice(0, Math.max(0, n));
  };

  // An internal function to generate lookup iterators.
  var lookupIterator = function(value) {
    if (value == null) return _.identity;
    if (_.isFunction(value)) return value;
    return _.property(value);
  };

  // Sort the object's values by a criterion produced by an iterator.
  _.sortBy = function(obj, iterator, context) {
    iterator = lookupIterator(iterator);
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value: value,
        index: index,
        criteria: iterator.call(context, value, index, list)
      };
    }).sort(function(left, right) {
      var a = left.criteria;
      var b = right.criteria;
      if (a !== b) {
        if (a > b || a === void 0) return 1;
        if (a < b || b === void 0) return -1;
      }
      return left.index - right.index;
    }), 'value');
  };

  // An internal function used for aggregate "group by" operations.
  var group = function(behavior) {
    return function(obj, iterator, context) {
      var result = {};
      iterator = lookupIterator(iterator);
      each(obj, function(value, index) {
        var key = iterator.call(context, value, index, obj);
        behavior(result, key, value);
      });
      return result;
    };
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = group(function(result, key, value) {
    _.has(result, key) ? result[key].push(value) : result[key] = [value];
  });

  // Indexes the object's values by a criterion, similar to `groupBy`, but for
  // when you know that your index values will be unique.
  _.indexBy = group(function(result, key, value) {
    result[key] = value;
  });

  // Counts instances of an object that group by a certain criterion. Pass
  // either a string attribute to count by, or a function that returns the
  // criterion.
  _.countBy = group(function(result, key) {
    _.has(result, key) ? result[key]++ : result[key] = 1;
  });

  // Use a comparator function to figure out the smallest index at which
  // an object should be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iterator, context) {
    iterator = lookupIterator(iterator);
    var value = iterator.call(context, obj);
    var low = 0, high = array.length;
    while (low < high) {
      var mid = (low + high) >>> 1;
      iterator.call(context, array[mid]) < value ? low = mid + 1 : high = mid;
    }
    return low;
  };

  // Safely create a real, live array from anything iterable.
  _.toArray = function(obj) {
    if (!obj) return [];
    if (_.isArray(obj)) return slice.call(obj);
    if (obj.length === +obj.length) return _.map(obj, _.identity);
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    if (obj == null) return 0;
    return (obj.length === +obj.length) ? obj.length : _.keys(obj).length;
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    if (array == null) return void 0;
    if ((n == null) || guard) return array[0];
    if (n < 0) return [];
    return slice.call(array, 0, n);
  };

  // Returns everything but the last entry of the array. Especially useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N. The **guard** check allows it to work with
  // `_.map`.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, array.length - ((n == null) || guard ? 1 : n));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array. The **guard** check allows it to work with `_.map`.
  _.last = function(array, n, guard) {
    if (array == null) return void 0;
    if ((n == null) || guard) return array[array.length - 1];
    return slice.call(array, Math.max(array.length - n, 0));
  };

  // Returns everything but the first entry of the array. Aliased as `tail` and `drop`.
  // Especially useful on the arguments object. Passing an **n** will return
  // the rest N values in the array. The **guard**
  // check allows it to work with `_.map`.
  _.rest = _.tail = _.drop = function(array, n, guard) {
    return slice.call(array, (n == null) || guard ? 1 : n);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, _.identity);
  };

  // Internal implementation of a recursive `flatten` function.
  var flatten = function(input, shallow, output) {
    if (shallow && _.every(input, _.isArray)) {
      return concat.apply(output, input);
    }
    each(input, function(value) {
      if (_.isArray(value) || _.isArguments(value)) {
        shallow ? push.apply(output, value) : flatten(value, shallow, output);
      } else {
        output.push(value);
      }
    });
    return output;
  };

  // Flatten out an array, either recursively (by default), or just one level.
  _.flatten = function(array, shallow) {
    return flatten(array, shallow, []);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Split an array into two arrays: one whose elements all satisfy the given
  // predicate, and one whose elements all do not satisfy the predicate.
  _.partition = function(array, predicate) {
    var pass = [], fail = [];
    each(array, function(elem) {
      (predicate(elem) ? pass : fail).push(elem);
    });
    return [pass, fail];
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iterator, context) {
    if (_.isFunction(isSorted)) {
      context = iterator;
      iterator = isSorted;
      isSorted = false;
    }
    var initial = iterator ? _.map(array, iterator, context) : array;
    var results = [];
    var seen = [];
    each(initial, function(value, index) {
      if (isSorted ? (!index || seen[seen.length - 1] !== value) : !_.contains(seen, value)) {
        seen.push(value);
        results.push(array[index]);
      }
    });
    return results;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(_.flatten(arguments, true));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays.
  _.intersection = function(array) {
    var rest = slice.call(arguments, 1);
    return _.filter(_.uniq(array), function(item) {
      return _.every(rest, function(other) {
        return _.contains(other, item);
      });
    });
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = concat.apply(ArrayProto, slice.call(arguments, 1));
    return _.filter(array, function(value){ return !_.contains(rest, value); });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function() {
    var length = _.max(_.pluck(arguments, 'length').concat(0));
    var results = new Array(length);
    for (var i = 0; i < length; i++) {
      results[i] = _.pluck(arguments, '' + i);
    }
    return results;
  };

  // Converts lists into objects. Pass either a single array of `[key, value]`
  // pairs, or two parallel arrays of the same length -- one of keys, and one of
  // the corresponding values.
  _.object = function(list, values) {
    if (list == null) return {};
    var result = {};
    for (var i = 0, length = list.length; i < length; i++) {
      if (values) {
        result[list[i]] = values[i];
      } else {
        result[list[i][0]] = list[i][1];
      }
    }
    return result;
  };

  // If the browser doesn't supply us with indexOf (I'm looking at you, **MSIE**),
  // we need this function. Return the position of the first occurrence of an
  // item in an array, or -1 if the item is not included in the array.
  // Delegates to **ECMAScript 5**'s native `indexOf` if available.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = function(array, item, isSorted) {
    if (array == null) return -1;
    var i = 0, length = array.length;
    if (isSorted) {
      if (typeof isSorted == 'number') {
        i = (isSorted < 0 ? Math.max(0, length + isSorted) : isSorted);
      } else {
        i = _.sortedIndex(array, item);
        return array[i] === item ? i : -1;
      }
    }
    if (nativeIndexOf && array.indexOf === nativeIndexOf) return array.indexOf(item, isSorted);
    for (; i < length; i++) if (array[i] === item) return i;
    return -1;
  };

  // Delegates to **ECMAScript 5**'s native `lastIndexOf` if available.
  _.lastIndexOf = function(array, item, from) {
    if (array == null) return -1;
    var hasIndex = from != null;
    if (nativeLastIndexOf && array.lastIndexOf === nativeLastIndexOf) {
      return hasIndex ? array.lastIndexOf(item, from) : array.lastIndexOf(item);
    }
    var i = (hasIndex ? from : array.length);
    while (i--) if (array[i] === item) return i;
    return -1;
  };

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (arguments.length <= 1) {
      stop = start || 0;
      start = 0;
    }
    step = arguments[2] || 1;

    var length = Math.max(Math.ceil((stop - start) / step), 0);
    var idx = 0;
    var range = new Array(length);

    while(idx < length) {
      range[idx++] = start;
      start += step;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Reusable constructor function for prototype setting.
  var ctor = function(){};

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Delegates to **ECMAScript 5**'s native `Function.bind` if
  // available.
  _.bind = function(func, context) {
    var args, bound;
    if (nativeBind && func.bind === nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError;
    args = slice.call(arguments, 2);
    return bound = function() {
      if (!(this instanceof bound)) return func.apply(context, args.concat(slice.call(arguments)));
      ctor.prototype = func.prototype;
      var self = new ctor;
      ctor.prototype = null;
      var result = func.apply(self, args.concat(slice.call(arguments)));
      if (Object(result) === result) return result;
      return self;
    };
  };

  // Partially apply a function by creating a version that has had some of its
  // arguments pre-filled, without changing its dynamic `this` context. _ acts
  // as a placeholder, allowing any combination of arguments to be pre-filled.
  _.partial = function(func) {
    var boundArgs = slice.call(arguments, 1);
    return function() {
      var position = 0;
      var args = boundArgs.slice();
      for (var i = 0, length = args.length; i < length; i++) {
        if (args[i] === _) args[i] = arguments[position++];
      }
      while (position < arguments.length) args.push(arguments[position++]);
      return func.apply(this, args);
    };
  };

  // Bind a number of an object's methods to that object. Remaining arguments
  // are the method names to be bound. Useful for ensuring that all callbacks
  // defined on an object belong to it.
  _.bindAll = function(obj) {
    var funcs = slice.call(arguments, 1);
    if (funcs.length === 0) throw new Error('bindAll must be passed function names');
    each(funcs, function(f) { obj[f] = _.bind(obj[f], obj); });
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memo = {};
    hasher || (hasher = _.identity);
    return function() {
      var key = hasher.apply(this, arguments);
      return _.has(memo, key) ? memo[key] : (memo[key] = func.apply(this, arguments));
    };
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){ return func.apply(null, args); }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = function(func) {
    return _.delay.apply(_, [func, 1].concat(slice.call(arguments, 1)));
  };

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time. Normally, the throttled function will run
  // as much as it can, without ever going more than once per `wait` duration;
  // but if you'd like to disable the execution on the leading edge, pass
  // `{leading: false}`. To disable execution on the trailing edge, ditto.
  _.throttle = function(func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    options || (options = {});
    var later = function() {
      previous = options.leading === false ? 0 : _.now();
      timeout = null;
      result = func.apply(context, args);
      context = args = null;
    };
    return function() {
      var now = _.now();
      if (!previous && options.leading === false) previous = now;
      var remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0) {
        clearTimeout(timeout);
        timeout = null;
        previous = now;
        result = func.apply(context, args);
        context = args = null;
      } else if (!timeout && options.trailing !== false) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout, args, context, timestamp, result;

    var later = function() {
      var last = _.now() - timestamp;
      if (last < wait) {
        timeout = setTimeout(later, wait - last);
      } else {
        timeout = null;
        if (!immediate) {
          result = func.apply(context, args);
          context = args = null;
        }
      }
    };

    return function() {
      context = this;
      args = arguments;
      timestamp = _.now();
      var callNow = immediate && !timeout;
      if (!timeout) {
        timeout = setTimeout(later, wait);
      }
      if (callNow) {
        result = func.apply(context, args);
        context = args = null;
      }

      return result;
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = function(func) {
    var ran = false, memo;
    return function() {
      if (ran) return memo;
      ran = true;
      memo = func.apply(this, arguments);
      func = null;
      return memo;
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return _.partial(wrapper, func);
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var funcs = arguments;
    return function() {
      var args = arguments;
      for (var i = funcs.length - 1; i >= 0; i--) {
        args = [funcs[i].apply(this, args)];
      }
      return args[0];
    };
  };

  // Returns a function that will only be executed after being called N times.
  _.after = function(times, func) {
    return function() {
      if (--times < 1) {
        return func.apply(this, arguments);
      }
    };
  };

  // Object Functions
  // ----------------

  // Retrieve the names of an object's properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = function(obj) {
    if (!_.isObject(obj)) return [];
    if (nativeKeys) return nativeKeys(obj);
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys.push(key);
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var values = new Array(length);
    for (var i = 0; i < length; i++) {
      values[i] = obj[keys[i]];
    }
    return values;
  };

  // Convert an object into a list of `[key, value]` pairs.
  _.pairs = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var pairs = new Array(length);
    for (var i = 0; i < length; i++) {
      pairs[i] = [keys[i], obj[keys[i]]];
    }
    return pairs;
  };

  // Invert the keys and values of an object. The values must be serializable.
  _.invert = function(obj) {
    var result = {};
    var keys = _.keys(obj);
    for (var i = 0, length = keys.length; i < length; i++) {
      result[obj[keys[i]]] = keys[i];
    }
    return result;
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      if (source) {
        for (var prop in source) {
          obj[prop] = source[prop];
        }
      }
    });
    return obj;
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(obj) {
    var copy = {};
    var keys = concat.apply(ArrayProto, slice.call(arguments, 1));
    each(keys, function(key) {
      if (key in obj) copy[key] = obj[key];
    });
    return copy;
  };

   // Return a copy of the object without the blacklisted properties.
  _.omit = function(obj) {
    var copy = {};
    var keys = concat.apply(ArrayProto, slice.call(arguments, 1));
    for (var key in obj) {
      if (!_.contains(keys, key)) copy[key] = obj[key];
    }
    return copy;
  };

  // Fill in a given object with default properties.
  _.defaults = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      if (source) {
        for (var prop in source) {
          if (obj[prop] === void 0) obj[prop] = source[prop];
        }
      }
    });
    return obj;
  };

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Internal recursive comparison function for `isEqual`.
  var eq = function(a, b, aStack, bStack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
    if (a === b) return a !== 0 || 1 / a == 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a instanceof _) a = a._wrapped;
    if (b instanceof _) b = b._wrapped;
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className != toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, dates, and booleans are compared by value.
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return a == String(b);
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive. An `egal` comparison is performed for
        // other numeric values.
        return a != +a ? b != +b : (a == 0 ? 1 / a == 1 / b : a == +b);
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a == +b;
      // RegExps are compared by their source patterns and flags.
      case '[object RegExp]':
        return a.source == b.source &&
               a.global == b.global &&
               a.multiline == b.multiline &&
               a.ignoreCase == b.ignoreCase;
    }
    if (typeof a != 'object' || typeof b != 'object') return false;
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] == a) return bStack[length] == b;
    }
    // Objects with different constructors are not equivalent, but `Object`s
    // from different frames are.
    var aCtor = a.constructor, bCtor = b.constructor;
    if (aCtor !== bCtor && !(_.isFunction(aCtor) && (aCtor instanceof aCtor) &&
                             _.isFunction(bCtor) && (bCtor instanceof bCtor))
                        && ('constructor' in a && 'constructor' in b)) {
      return false;
    }
    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);
    var size = 0, result = true;
    // Recursively compare objects and arrays.
    if (className == '[object Array]') {
      // Compare array lengths to determine if a deep comparison is necessary.
      size = a.length;
      result = size == b.length;
      if (result) {
        // Deep compare the contents, ignoring non-numeric properties.
        while (size--) {
          if (!(result = eq(a[size], b[size], aStack, bStack))) break;
        }
      }
    } else {
      // Deep compare objects.
      for (var key in a) {
        if (_.has(a, key)) {
          // Count the expected number of properties.
          size++;
          // Deep compare each member.
          if (!(result = _.has(b, key) && eq(a[key], b[key], aStack, bStack))) break;
        }
      }
      // Ensure that both objects contain the same number of properties.
      if (result) {
        for (key in b) {
          if (_.has(b, key) && !(size--)) break;
        }
        result = !size;
      }
    }
    // Remove the first object from the stack of traversed objects.
    aStack.pop();
    bStack.pop();
    return result;
  };

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b, [], []);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (_.isArray(obj) || _.isString(obj)) return obj.length === 0;
    for (var key in obj) if (_.has(obj, key)) return false;
    return true;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType === 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) == '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    return obj === Object(obj);
  };

  // Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp.
  each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp'], function(name) {
    _['is' + name] = function(obj) {
      return toString.call(obj) == '[object ' + name + ']';
    };
  });

  // Define a fallback version of the method in browsers (ahem, IE), where
  // there isn't any inspectable "Arguments" type.
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return !!(obj && _.has(obj, 'callee'));
    };
  }

  // Optimize `isFunction` if appropriate.
  if (typeof (/./) !== 'function') {
    _.isFunction = function(obj) {
      return typeof obj === 'function';
    };
  }

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return isFinite(obj) && !isNaN(parseFloat(obj));
  };

  // Is the given value `NaN`? (NaN is the only number which does not equal itself).
  _.isNaN = function(obj) {
    return _.isNumber(obj) && obj != +obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) == '[object Boolean]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Shortcut function for checking if an object has a given property directly
  // on itself (in other words, not on a prototype).
  _.has = function(obj, key) {
    return hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iterators.
  _.identity = function(value) {
    return value;
  };

  _.constant = function(value) {
    return function () {
      return value;
    };
  };

  _.property = function(key) {
    return function(obj) {
      return obj[key];
    };
  };

  // Returns a predicate for checking whether an object has a given set of `key:value` pairs.
  _.matches = function(attrs) {
    return function(obj) {
      if (obj === attrs) return true; //avoid comparing an object to itself.
      for (var key in attrs) {
        if (attrs[key] !== obj[key])
          return false;
      }
      return true;
    }
  };

  // Run a function **n** times.
  _.times = function(n, iterator, context) {
    var accum = Array(Math.max(0, n));
    for (var i = 0; i < n; i++) accum[i] = iterator.call(context, i);
    return accum;
  };

  // Return a random integer between min and max (inclusive).
  _.random = function(min, max) {
    if (max == null) {
      max = min;
      min = 0;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  };

  // A (possibly faster) way to get the current timestamp as an integer.
  _.now = Date.now || function() { return new Date().getTime(); };

  // List of HTML entities for escaping.
  var entityMap = {
    escape: {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;'
    }
  };
  entityMap.unescape = _.invert(entityMap.escape);

  // Regexes containing the keys and values listed immediately above.
  var entityRegexes = {
    escape:   new RegExp('[' + _.keys(entityMap.escape).join('') + ']', 'g'),
    unescape: new RegExp('(' + _.keys(entityMap.unescape).join('|') + ')', 'g')
  };

  // Functions for escaping and unescaping strings to/from HTML interpolation.
  _.each(['escape', 'unescape'], function(method) {
    _[method] = function(string) {
      if (string == null) return '';
      return ('' + string).replace(entityRegexes[method], function(match) {
        return entityMap[method][match];
      });
    };
  });

  // If the value of the named `property` is a function then invoke it with the
  // `object` as context; otherwise, return it.
  _.result = function(object, property) {
    if (object == null) return void 0;
    var value = object[property];
    return _.isFunction(value) ? value.call(object) : value;
  };

  // Add your own custom functions to the Underscore object.
  _.mixin = function(obj) {
    each(_.functions(obj), function(name) {
      var func = _[name] = obj[name];
      _.prototype[name] = function() {
        var args = [this._wrapped];
        push.apply(args, arguments);
        return result.call(this, func.apply(_, args));
      };
    });
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = ++idCounter + '';
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /(.)^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    "'":      "'",
    '\\':     '\\',
    '\r':     'r',
    '\n':     'n',
    '\t':     't',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  var escaper = /\\|'|\r|\n|\t|\u2028|\u2029/g;

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  _.template = function(text, data, settings) {
    var render;
    settings = _.defaults({}, settings, _.templateSettings);

    // Combine delimiters into one regular expression via alternation.
    var matcher = new RegExp([
      (settings.escape || noMatch).source,
      (settings.interpolate || noMatch).source,
      (settings.evaluate || noMatch).source
    ].join('|') + '|$', 'g');

    // Compile the template source, escaping string literals appropriately.
    var index = 0;
    var source = "__p+='";
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      source += text.slice(index, offset)
        .replace(escaper, function(match) { return '\\' + escapes[match]; });

      if (escape) {
        source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
      }
      if (interpolate) {
        source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
      }
      if (evaluate) {
        source += "';\n" + evaluate + "\n__p+='";
      }
      index = offset + match.length;
      return match;
    });
    source += "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __t,__p='',__j=Array.prototype.join," +
      "print=function(){__p+=__j.call(arguments,'');};\n" +
      source + "return __p;\n";

    try {
      render = new Function(settings.variable || 'obj', '_', source);
    } catch (e) {
      e.source = source;
      throw e;
    }

    if (data) return render(data, _);
    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled function source as a convenience for precompilation.
    template.source = 'function(' + (settings.variable || 'obj') + '){\n' + source + '}';

    return template;
  };

  // Add a "chain" function, which will delegate to the wrapper.
  _.chain = function(obj) {
    return _(obj).chain();
  };

  // OOP
  // ---------------
  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.

  // Helper function to continue chaining intermediate results.
  var result = function(obj) {
    return this._chain ? _(obj).chain() : obj;
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      var obj = this._wrapped;
      method.apply(obj, arguments);
      if ((name == 'shift' || name == 'splice') && obj.length === 0) delete obj[0];
      return result.call(this, obj);
    };
  });

  // Add all accessor Array functions to the wrapper.
  each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      return result.call(this, method.apply(this._wrapped, arguments));
    };
  });

  _.extend(_.prototype, {

    // Start chaining a wrapped Underscore object.
    chain: function() {
      this._chain = true;
      return this;
    },

    // Extracts the result from a wrapped and chained object.
    value: function() {
      return this._wrapped;
    }

  });

  // AMD registration happens at the end for compatibility with AMD loaders
  // that may not enforce next-turn semantics on modules. Even though general
  // practice for AMD registration is to be anonymous, underscore registers
  // as a named module because, like jQuery, it is a base library that is
  // popular enough to be bundled in a third party lib, but not be part of
  // an AMD load request. Those cases could generate an error when an
  // anonymous define() is called outside of a loader request.
  if (typeof define === 'function' && define.amd) {
    define('underscore', [], function() {
      return _;
    });
  }
}).call(this);

//     Backbone.js 1.1.2

//     (c) 2010-2014 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Backbone may be freely distributed under the MIT license.
//     For all details and documentation:
//     http://backbonejs.org

(function(root, factory) {

  // Set up Backbone appropriately for the environment. Start with AMD.
  if (typeof define === 'function' && define.amd) {
    define(['underscore', 'jquery', 'exports'], function(_, $, exports) {
      // Export global even in AMD case in case this script is loaded with
      // others that may still expect a global Backbone.
      root.Backbone = factory(root, exports, _, $);
    });

  // Next for Node.js or CommonJS. jQuery may not be needed as a module.
  } else if (typeof exports !== 'undefined') {
    var _ = require('underscore');
    factory(root, exports, _);

  // Finally, as a browser global.
  } else {
    root.Backbone = factory(root, {}, root._, (root.jQuery || root.Zepto || root.ender || root.$));
  }

}(this, function(root, Backbone, _, $) {

  // Initial Setup
  // -------------

  // Save the previous value of the `Backbone` variable, so that it can be
  // restored later on, if `noConflict` is used.
  var previousBackbone = root.Backbone;

  // Create local references to array methods we'll want to use later.
  var array = [];
  var push = array.push;
  var slice = array.slice;
  var splice = array.splice;

  // Current version of the library. Keep in sync with `package.json`.
  Backbone.VERSION = '1.1.2';

  // For Backbone's purposes, jQuery, Zepto, Ender, or My Library (kidding) owns
  // the `$` variable.
  Backbone.$ = $;

  // Runs Backbone.js in *noConflict* mode, returning the `Backbone` variable
  // to its previous owner. Returns a reference to this Backbone object.
  Backbone.noConflict = function() {
    root.Backbone = previousBackbone;
    return this;
  };

  // Turn on `emulateHTTP` to support legacy HTTP servers. Setting this option
  // will fake `"PATCH"`, `"PUT"` and `"DELETE"` requests via the `_method` parameter and
  // set a `X-Http-Method-Override` header.
  Backbone.emulateHTTP = false;

  // Turn on `emulateJSON` to support legacy servers that can't deal with direct
  // `application/json` requests ... will encode the body as
  // `application/x-www-form-urlencoded` instead and will send the model in a
  // form param named `model`.
  Backbone.emulateJSON = false;

  // Backbone.Events
  // ---------------

  // A module that can be mixed in to *any object* in order to provide it with
  // custom events. You may bind with `on` or remove with `off` callback
  // functions to an event; `trigger`-ing an event fires all callbacks in
  // succession.
  //
  //     var object = {};
  //     _.extend(object, Backbone.Events);
  //     object.on('expand', function(){ alert('expanded'); });
  //     object.trigger('expand');
  //
  var Events = Backbone.Events = {

    // Bind an event to a `callback` function. Passing `"all"` will bind
    // the callback to all events fired.
    on: function(name, callback, context) {
      if (!eventsApi(this, 'on', name, [callback, context]) || !callback) return this;
      this._events || (this._events = {});
      var events = this._events[name] || (this._events[name] = []);
      events.push({callback: callback, context: context, ctx: context || this});
      return this;
    },

    // Bind an event to only be triggered a single time. After the first time
    // the callback is invoked, it will be removed.
    once: function(name, callback, context) {
      if (!eventsApi(this, 'once', name, [callback, context]) || !callback) return this;
      var self = this;
      var once = _.once(function() {
        self.off(name, once);
        callback.apply(this, arguments);
      });
      once._callback = callback;
      return this.on(name, once, context);
    },

    // Remove one or many callbacks. If `context` is null, removes all
    // callbacks with that function. If `callback` is null, removes all
    // callbacks for the event. If `name` is null, removes all bound
    // callbacks for all events.
    off: function(name, callback, context) {
      var retain, ev, events, names, i, l, j, k;
      if (!this._events || !eventsApi(this, 'off', name, [callback, context])) return this;
      if (!name && !callback && !context) {
        this._events = void 0;
        return this;
      }
      names = name ? [name] : _.keys(this._events);
      for (i = 0, l = names.length; i < l; i++) {
        name = names[i];
        if (events = this._events[name]) {
          this._events[name] = retain = [];
          if (callback || context) {
            for (j = 0, k = events.length; j < k; j++) {
              ev = events[j];
              if ((callback && callback !== ev.callback && callback !== ev.callback._callback) ||
                  (context && context !== ev.context)) {
                retain.push(ev);
              }
            }
          }
          if (!retain.length) delete this._events[name];
        }
      }

      return this;
    },

    // Trigger one or many events, firing all bound callbacks. Callbacks are
    // passed the same arguments as `trigger` is, apart from the event name
    // (unless you're listening on `"all"`, which will cause your callback to
    // receive the true name of the event as the first argument).
    trigger: function(name) {
      if (!this._events) return this;
      var args = slice.call(arguments, 1);
      if (!eventsApi(this, 'trigger', name, args)) return this;
      var events = this._events[name];
      var allEvents = this._events.all;
      if (events) triggerEvents(events, args);
      if (allEvents) triggerEvents(allEvents, arguments);
      return this;
    },

    // Tell this object to stop listening to either specific events ... or
    // to every object it's currently listening to.
    stopListening: function(obj, name, callback) {
      var listeningTo = this._listeningTo;
      if (!listeningTo) return this;
      var remove = !name && !callback;
      if (!callback && typeof name === 'object') callback = this;
      if (obj) (listeningTo = {})[obj._listenId] = obj;
      for (var id in listeningTo) {
        obj = listeningTo[id];
        obj.off(name, callback, this);
        if (remove || _.isEmpty(obj._events)) delete this._listeningTo[id];
      }
      return this;
    }

  };

  // Regular expression used to split event strings.
  var eventSplitter = /\s+/;

  // Implement fancy features of the Events API such as multiple event
  // names `"change blur"` and jQuery-style event maps `{change: action}`
  // in terms of the existing API.
  var eventsApi = function(obj, action, name, rest) {
    if (!name) return true;

    // Handle event maps.
    if (typeof name === 'object') {
      for (var key in name) {
        obj[action].apply(obj, [key, name[key]].concat(rest));
      }
      return false;
    }

    // Handle space separated event names.
    if (eventSplitter.test(name)) {
      var names = name.split(eventSplitter);
      for (var i = 0, l = names.length; i < l; i++) {
        obj[action].apply(obj, [names[i]].concat(rest));
      }
      return false;
    }

    return true;
  };

  // A difficult-to-believe, but optimized internal dispatch function for
  // triggering events. Tries to keep the usual cases speedy (most internal
  // Backbone events have 3 arguments).
  var triggerEvents = function(events, args) {
    var ev, i = -1, l = events.length, a1 = args[0], a2 = args[1], a3 = args[2];
    switch (args.length) {
      case 0: while (++i < l) (ev = events[i]).callback.call(ev.ctx); return;
      case 1: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1); return;
      case 2: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2); return;
      case 3: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2, a3); return;
      default: while (++i < l) (ev = events[i]).callback.apply(ev.ctx, args); return;
    }
  };

  var listenMethods = {listenTo: 'on', listenToOnce: 'once'};

  // Inversion-of-control versions of `on` and `once`. Tell *this* object to
  // listen to an event in another object ... keeping track of what it's
  // listening to.
  _.each(listenMethods, function(implementation, method) {
    Events[method] = function(obj, name, callback) {
      var listeningTo = this._listeningTo || (this._listeningTo = {});
      var id = obj._listenId || (obj._listenId = _.uniqueId('l'));
      listeningTo[id] = obj;
      if (!callback && typeof name === 'object') callback = this;
      obj[implementation](name, callback, this);
      return this;
    };
  });

  // Aliases for backwards compatibility.
  Events.bind   = Events.on;
  Events.unbind = Events.off;

  // Allow the `Backbone` object to serve as a global event bus, for folks who
  // want global "pubsub" in a convenient place.
  _.extend(Backbone, Events);

  // Backbone.Model
  // --------------

  // Backbone **Models** are the basic data object in the framework --
  // frequently representing a row in a table in a database on your server.
  // A discrete chunk of data and a bunch of useful, related methods for
  // performing computations and transformations on that data.

  // Create a new model with the specified attributes. A client id (`cid`)
  // is automatically generated and assigned for you.
  var Model = Backbone.Model = function(attributes, options) {
    var attrs = attributes || {};
    options || (options = {});
    this.cid = _.uniqueId('c');
    this.attributes = {};
    if (options.collection) this.collection = options.collection;
    if (options.parse) attrs = this.parse(attrs, options) || {};
    attrs = _.defaults({}, attrs, _.result(this, 'defaults'));
    this.set(attrs, options);
    this.changed = {};
    this.initialize.apply(this, arguments);
  };

  // Attach all inheritable methods to the Model prototype.
  _.extend(Model.prototype, Events, {

    // A hash of attributes whose current and previous value differ.
    changed: null,

    // The value returned during the last failed validation.
    validationError: null,

    // The default name for the JSON `id` attribute is `"id"`. MongoDB and
    // CouchDB users may want to set this to `"_id"`.
    idAttribute: 'id',

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // Return a copy of the model's `attributes` object.
    toJSON: function(options) {
      return _.clone(this.attributes);
    },

    // Proxy `Backbone.sync` by default -- but override this if you need
    // custom syncing semantics for *this* particular model.
    sync: function() {
      return Backbone.sync.apply(this, arguments);
    },

    // Get the value of an attribute.
    get: function(attr) {
      return this.attributes[attr];
    },

    // Get the HTML-escaped value of an attribute.
    escape: function(attr) {
      return _.escape(this.get(attr));
    },

    // Returns `true` if the attribute contains a value that is not null
    // or undefined.
    has: function(attr) {
      return this.get(attr) != null;
    },

    // Set a hash of model attributes on the object, firing `"change"`. This is
    // the core primitive operation of a model, updating the data and notifying
    // anyone who needs to know about the change in state. The heart of the beast.
    set: function(key, val, options) {
      var attr, attrs, unset, changes, silent, changing, prev, current;
      if (key == null) return this;

      // Handle both `"key", value` and `{key: value}` -style arguments.
      if (typeof key === 'object') {
        attrs = key;
        options = val;
      } else {
        (attrs = {})[key] = val;
      }

      options || (options = {});

      // Run validation.
      if (!this._validate(attrs, options)) return false;

      // Extract attributes and options.
      unset           = options.unset;
      silent          = options.silent;
      changes         = [];
      changing        = this._changing;
      this._changing  = true;

      if (!changing) {
        this._previousAttributes = _.clone(this.attributes);
        this.changed = {};
      }
      current = this.attributes, prev = this._previousAttributes;

      // Check for changes of `id`.
      if (this.idAttribute in attrs) this.id = attrs[this.idAttribute];

      // For each `set` attribute, update or delete the current value.
      for (attr in attrs) {
        val = attrs[attr];
        if (!_.isEqual(current[attr], val)) changes.push(attr);
        if (!_.isEqual(prev[attr], val)) {
          this.changed[attr] = val;
        } else {
          delete this.changed[attr];
        }
        unset ? delete current[attr] : current[attr] = val;
      }

      // Trigger all relevant attribute changes.
      if (!silent) {
        if (changes.length) this._pending = options;
        for (var i = 0, l = changes.length; i < l; i++) {
          this.trigger('change:' + changes[i], this, current[changes[i]], options);
        }
      }

      // You might be wondering why there's a `while` loop here. Changes can
      // be recursively nested within `"change"` events.
      if (changing) return this;
      if (!silent) {
        while (this._pending) {
          options = this._pending;
          this._pending = false;
          this.trigger('change', this, options);
        }
      }
      this._pending = false;
      this._changing = false;
      return this;
    },

    // Remove an attribute from the model, firing `"change"`. `unset` is a noop
    // if the attribute doesn't exist.
    unset: function(attr, options) {
      return this.set(attr, void 0, _.extend({}, options, {unset: true}));
    },

    // Clear all attributes on the model, firing `"change"`.
    clear: function(options) {
      var attrs = {};
      for (var key in this.attributes) attrs[key] = void 0;
      return this.set(attrs, _.extend({}, options, {unset: true}));
    },

    // Determine if the model has changed since the last `"change"` event.
    // If you specify an attribute name, determine if that attribute has changed.
    hasChanged: function(attr) {
      if (attr == null) return !_.isEmpty(this.changed);
      return _.has(this.changed, attr);
    },

    // Return an object containing all the attributes that have changed, or
    // false if there are no changed attributes. Useful for determining what
    // parts of a view need to be updated and/or what attributes need to be
    // persisted to the server. Unset attributes will be set to undefined.
    // You can also pass an attributes object to diff against the model,
    // determining if there *would be* a change.
    changedAttributes: function(diff) {
      if (!diff) return this.hasChanged() ? _.clone(this.changed) : false;
      var val, changed = false;
      var old = this._changing ? this._previousAttributes : this.attributes;
      for (var attr in diff) {
        if (_.isEqual(old[attr], (val = diff[attr]))) continue;
        (changed || (changed = {}))[attr] = val;
      }
      return changed;
    },

    // Get the previous value of an attribute, recorded at the time the last
    // `"change"` event was fired.
    previous: function(attr) {
      if (attr == null || !this._previousAttributes) return null;
      return this._previousAttributes[attr];
    },

    // Get all of the attributes of the model at the time of the previous
    // `"change"` event.
    previousAttributes: function() {
      return _.clone(this._previousAttributes);
    },

    // Fetch the model from the server. If the server's representation of the
    // model differs from its current attributes, they will be overridden,
    // triggering a `"change"` event.
    fetch: function(options) {
      options = options ? _.clone(options) : {};
      if (options.parse === void 0) options.parse = true;
      var model = this;
      var success = options.success;
      options.success = function(resp) {
        if (!model.set(model.parse(resp, options), options)) return false;
        if (success) success(model, resp, options);
        model.trigger('sync', model, resp, options);
      };
      wrapError(this, options);
      return this.sync('read', this, options);
    },

    // Set a hash of model attributes, and sync the model to the server.
    // If the server returns an attributes hash that differs, the model's
    // state will be `set` again.
    save: function(key, val, options) {
      var attrs, method, xhr, attributes = this.attributes;

      // Handle both `"key", value` and `{key: value}` -style arguments.
      if (key == null || typeof key === 'object') {
        attrs = key;
        options = val;
      } else {
        (attrs = {})[key] = val;
      }

      options = _.extend({validate: true}, options);

      // If we're not waiting and attributes exist, save acts as
      // `set(attr).save(null, opts)` with validation. Otherwise, check if
      // the model will be valid when the attributes, if any, are set.
      if (attrs && !options.wait) {
        if (!this.set(attrs, options)) return false;
      } else {
        if (!this._validate(attrs, options)) return false;
      }

      // Set temporary attributes if `{wait: true}`.
      if (attrs && options.wait) {
        this.attributes = _.extend({}, attributes, attrs);
      }

      // After a successful server-side save, the client is (optionally)
      // updated with the server-side state.
      if (options.parse === void 0) options.parse = true;
      var model = this;
      var success = options.success;
      options.success = function(resp) {
        // Ensure attributes are restored during synchronous saves.
        model.attributes = attributes;
        var serverAttrs = model.parse(resp, options);
        if (options.wait) serverAttrs = _.extend(attrs || {}, serverAttrs);
        if (_.isObject(serverAttrs) && !model.set(serverAttrs, options)) {
          return false;
        }
        if (success) success(model, resp, options);
        model.trigger('sync', model, resp, options);
      };
      wrapError(this, options);

      method = this.isNew() ? 'create' : (options.patch ? 'patch' : 'update');
      if (method === 'patch') options.attrs = attrs;
      xhr = this.sync(method, this, options);

      // Restore attributes.
      if (attrs && options.wait) this.attributes = attributes;

      return xhr;
    },

    // Destroy this model on the server if it was already persisted.
    // Optimistically removes the model from its collection, if it has one.
    // If `wait: true` is passed, waits for the server to respond before removal.
    destroy: function(options) {
      options = options ? _.clone(options) : {};
      var model = this;
      var success = options.success;

      var destroy = function() {
        model.trigger('destroy', model, model.collection, options);
      };

      options.success = function(resp) {
        if (options.wait || model.isNew()) destroy();
        if (success) success(model, resp, options);
        if (!model.isNew()) model.trigger('sync', model, resp, options);
      };

      if (this.isNew()) {
        options.success();
        return false;
      }
      wrapError(this, options);

      var xhr = this.sync('delete', this, options);
      if (!options.wait) destroy();
      return xhr;
    },

    // Default URL for the model's representation on the server -- if you're
    // using Backbone's restful methods, override this to change the endpoint
    // that will be called.
    url: function() {
      var base =
        _.result(this, 'urlRoot') ||
        _.result(this.collection, 'url') ||
        urlError();
      if (this.isNew()) return base;
      return base.replace(/([^\/])$/, '$1/') + encodeURIComponent(this.id);
    },

    // **parse** converts a response into the hash of attributes to be `set` on
    // the model. The default implementation is just to pass the response along.
    parse: function(resp, options) {
      return resp;
    },

    // Create a new model with identical attributes to this one.
    clone: function() {
      return new this.constructor(this.attributes);
    },

    // A model is new if it has never been saved to the server, and lacks an id.
    isNew: function() {
      return !this.has(this.idAttribute);
    },

    // Check if the model is currently in a valid state.
    isValid: function(options) {
      return this._validate({}, _.extend(options || {}, { validate: true }));
    },

    // Run validation against the next complete set of model attributes,
    // returning `true` if all is well. Otherwise, fire an `"invalid"` event.
    _validate: function(attrs, options) {
      if (!options.validate || !this.validate) return true;
      attrs = _.extend({}, this.attributes, attrs);
      var error = this.validationError = this.validate(attrs, options) || null;
      if (!error) return true;
      this.trigger('invalid', this, error, _.extend(options, {validationError: error}));
      return false;
    }

  });

  // Underscore methods that we want to implement on the Model.
  var modelMethods = ['keys', 'values', 'pairs', 'invert', 'pick', 'omit'];

  // Mix in each Underscore method as a proxy to `Model#attributes`.
  _.each(modelMethods, function(method) {
    Model.prototype[method] = function() {
      var args = slice.call(arguments);
      args.unshift(this.attributes);
      return _[method].apply(_, args);
    };
  });

  // Backbone.Collection
  // -------------------

  // If models tend to represent a single row of data, a Backbone Collection is
  // more analagous to a table full of data ... or a small slice or page of that
  // table, or a collection of rows that belong together for a particular reason
  // -- all of the messages in this particular folder, all of the documents
  // belonging to this particular author, and so on. Collections maintain
  // indexes of their models, both in order, and for lookup by `id`.

  // Create a new **Collection**, perhaps to contain a specific type of `model`.
  // If a `comparator` is specified, the Collection will maintain
  // its models in sort order, as they're added and removed.
  var Collection = Backbone.Collection = function(models, options) {
    options || (options = {});
    if (options.model) this.model = options.model;
    if (options.comparator !== void 0) this.comparator = options.comparator;
    this._reset();
    this.initialize.apply(this, arguments);
    if (models) this.reset(models, _.extend({silent: true}, options));
  };

  // Default options for `Collection#set`.
  var setOptions = {add: true, remove: true, merge: true};
  var addOptions = {add: true, remove: false};

  // Define the Collection's inheritable methods.
  _.extend(Collection.prototype, Events, {

    // The default model for a collection is just a **Backbone.Model**.
    // This should be overridden in most cases.
    model: Model,

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // The JSON representation of a Collection is an array of the
    // models' attributes.
    toJSON: function(options) {
      return this.map(function(model){ return model.toJSON(options); });
    },

    // Proxy `Backbone.sync` by default.
    sync: function() {
      return Backbone.sync.apply(this, arguments);
    },

    // Add a model, or list of models to the set.
    add: function(models, options) {
      return this.set(models, _.extend({merge: false}, options, addOptions));
    },

    // Remove a model, or a list of models from the set.
    remove: function(models, options) {
      var singular = !_.isArray(models);
      models = singular ? [models] : _.clone(models);
      options || (options = {});
      var i, l, index, model;
      for (i = 0, l = models.length; i < l; i++) {
        model = models[i] = this.get(models[i]);
        if (!model) continue;
        delete this._byId[model.id];
        delete this._byId[model.cid];
        index = this.indexOf(model);
        this.models.splice(index, 1);
        this.length--;
        if (!options.silent) {
          options.index = index;
          model.trigger('remove', model, this, options);
        }
        this._removeReference(model, options);
      }
      return singular ? models[0] : models;
    },

    // Update a collection by `set`-ing a new list of models, adding new ones,
    // removing models that are no longer present, and merging models that
    // already exist in the collection, as necessary. Similar to **Model#set**,
    // the core operation for updating the data contained by the collection.
    set: function(models, options) {
      options = _.defaults({}, options, setOptions);
      if (options.parse) models = this.parse(models, options);
      var singular = !_.isArray(models);
      models = singular ? (models ? [models] : []) : _.clone(models);
      var i, l, id, model, attrs, existing, sort;
      var at = options.at;
      var targetModel = this.model;
      var sortable = this.comparator && (at == null) && options.sort !== false;
      var sortAttr = _.isString(this.comparator) ? this.comparator : null;
      var toAdd = [], toRemove = [], modelMap = {};
      var add = options.add, merge = options.merge, remove = options.remove;
      var order = !sortable && add && remove ? [] : false;

      // Turn bare objects into model references, and prevent invalid models
      // from being added.
      for (i = 0, l = models.length; i < l; i++) {
        attrs = models[i] || {};
        if (attrs instanceof Model) {
          id = model = attrs;
        } else {
          id = attrs[targetModel.prototype.idAttribute || 'id'];
        }

        // If a duplicate is found, prevent it from being added and
        // optionally merge it into the existing model.
        if (existing = this.get(id)) {
          if (remove) modelMap[existing.cid] = true;
          if (merge) {
            attrs = attrs === model ? model.attributes : attrs;
            if (options.parse) attrs = existing.parse(attrs, options);
            existing.set(attrs, options);
            if (sortable && !sort && existing.hasChanged(sortAttr)) sort = true;
          }
          models[i] = existing;

        // If this is a new, valid model, push it to the `toAdd` list.
        } else if (add) {
          model = models[i] = this._prepareModel(attrs, options);
          if (!model) continue;
          toAdd.push(model);
          this._addReference(model, options);
        }

        // Do not add multiple models with the same `id`.
        model = existing || model;
        if (order && (model.isNew() || !modelMap[model.id])) order.push(model);
        modelMap[model.id] = true;
      }

      // Remove nonexistent models if appropriate.
      if (remove) {
        for (i = 0, l = this.length; i < l; ++i) {
          if (!modelMap[(model = this.models[i]).cid]) toRemove.push(model);
        }
        if (toRemove.length) this.remove(toRemove, options);
      }

      // See if sorting is needed, update `length` and splice in new models.
      if (toAdd.length || (order && order.length)) {
        if (sortable) sort = true;
        this.length += toAdd.length;
        if (at != null) {
          for (i = 0, l = toAdd.length; i < l; i++) {
            this.models.splice(at + i, 0, toAdd[i]);
          }
        } else {
          if (order) this.models.length = 0;
          var orderedModels = order || toAdd;
          for (i = 0, l = orderedModels.length; i < l; i++) {
            this.models.push(orderedModels[i]);
          }
        }
      }

      // Silently sort the collection if appropriate.
      if (sort) this.sort({silent: true});

      // Unless silenced, it's time to fire all appropriate add/sort events.
      if (!options.silent) {
        for (i = 0, l = toAdd.length; i < l; i++) {
          (model = toAdd[i]).trigger('add', model, this, options);
        }
        if (sort || (order && order.length)) this.trigger('sort', this, options);
      }

      // Return the added (or merged) model (or models).
      return singular ? models[0] : models;
    },

    // When you have more items than you want to add or remove individually,
    // you can reset the entire set with a new list of models, without firing
    // any granular `add` or `remove` events. Fires `reset` when finished.
    // Useful for bulk operations and optimizations.
    reset: function(models, options) {
      options || (options = {});
      for (var i = 0, l = this.models.length; i < l; i++) {
        this._removeReference(this.models[i], options);
      }
      options.previousModels = this.models;
      this._reset();
      models = this.add(models, _.extend({silent: true}, options));
      if (!options.silent) this.trigger('reset', this, options);
      return models;
    },

    // Add a model to the end of the collection.
    push: function(model, options) {
      return this.add(model, _.extend({at: this.length}, options));
    },

    // Remove a model from the end of the collection.
    pop: function(options) {
      var model = this.at(this.length - 1);
      this.remove(model, options);
      return model;
    },

    // Add a model to the beginning of the collection.
    unshift: function(model, options) {
      return this.add(model, _.extend({at: 0}, options));
    },

    // Remove a model from the beginning of the collection.
    shift: function(options) {
      var model = this.at(0);
      this.remove(model, options);
      return model;
    },

    // Slice out a sub-array of models from the collection.
    slice: function() {
      return slice.apply(this.models, arguments);
    },

    // Get a model from the set by id.
    get: function(obj) {
      if (obj == null) return void 0;
      return this._byId[obj] || this._byId[obj.id] || this._byId[obj.cid];
    },

    // Get the model at the given index.
    at: function(index) {
      return this.models[index];
    },

    // Return models with matching attributes. Useful for simple cases of
    // `filter`.
    where: function(attrs, first) {
      if (_.isEmpty(attrs)) return first ? void 0 : [];
      return this[first ? 'find' : 'filter'](function(model) {
        for (var key in attrs) {
          if (attrs[key] !== model.get(key)) return false;
        }
        return true;
      });
    },

    // Return the first model with matching attributes. Useful for simple cases
    // of `find`.
    findWhere: function(attrs) {
      return this.where(attrs, true);
    },

    // Force the collection to re-sort itself. You don't need to call this under
    // normal circumstances, as the set will maintain sort order as each item
    // is added.
    sort: function(options) {
      if (!this.comparator) throw new Error('Cannot sort a set without a comparator');
      options || (options = {});

      // Run sort based on type of `comparator`.
      if (_.isString(this.comparator) || this.comparator.length === 1) {
        this.models = this.sortBy(this.comparator, this);
      } else {
        this.models.sort(_.bind(this.comparator, this));
      }

      if (!options.silent) this.trigger('sort', this, options);
      return this;
    },

    // Pluck an attribute from each model in the collection.
    pluck: function(attr) {
      return _.invoke(this.models, 'get', attr);
    },

    // Fetch the default set of models for this collection, resetting the
    // collection when they arrive. If `reset: true` is passed, the response
    // data will be passed through the `reset` method instead of `set`.
    fetch: function(options) {
      options = options ? _.clone(options) : {};
      if (options.parse === void 0) options.parse = true;
      var success = options.success;
      var collection = this;
      options.success = function(resp) {
        var method = options.reset ? 'reset' : 'set';
        collection[method](resp, options);
        if (success) success(collection, resp, options);
        collection.trigger('sync', collection, resp, options);
      };
      wrapError(this, options);
      return this.sync('read', this, options);
    },

    // Create a new instance of a model in this collection. Add the model to the
    // collection immediately, unless `wait: true` is passed, in which case we
    // wait for the server to agree.
    create: function(model, options) {
      options = options ? _.clone(options) : {};
      if (!(model = this._prepareModel(model, options))) return false;
      if (!options.wait) this.add(model, options);
      var collection = this;
      var success = options.success;
      options.success = function(model, resp) {
        if (options.wait) collection.add(model, options);
        if (success) success(model, resp, options);
      };
      model.save(null, options);
      return model;
    },

    // **parse** converts a response into a list of models to be added to the
    // collection. The default implementation is just to pass it through.
    parse: function(resp, options) {
      return resp;
    },

    // Create a new collection with an identical list of models as this one.
    clone: function() {
      return new this.constructor(this.models);
    },

    // Private method to reset all internal state. Called when the collection
    // is first initialized or reset.
    _reset: function() {
      this.length = 0;
      this.models = [];
      this._byId  = {};
    },

    // Prepare a hash of attributes (or other model) to be added to this
    // collection.
    _prepareModel: function(attrs, options) {
      if (attrs instanceof Model) return attrs;
      options = options ? _.clone(options) : {};
      options.collection = this;
      var model = new this.model(attrs, options);
      if (!model.validationError) return model;
      this.trigger('invalid', this, model.validationError, options);
      return false;
    },

    // Internal method to create a model's ties to a collection.
    _addReference: function(model, options) {
      this._byId[model.cid] = model;
      if (model.id != null) this._byId[model.id] = model;
      if (!model.collection) model.collection = this;
      model.on('all', this._onModelEvent, this);
    },

    // Internal method to sever a model's ties to a collection.
    _removeReference: function(model, options) {
      if (this === model.collection) delete model.collection;
      model.off('all', this._onModelEvent, this);
    },

    // Internal method called every time a model in the set fires an event.
    // Sets need to update their indexes when models change ids. All other
    // events simply proxy through. "add" and "remove" events that originate
    // in other collections are ignored.
    _onModelEvent: function(event, model, collection, options) {
      if ((event === 'add' || event === 'remove') && collection !== this) return;
      if (event === 'destroy') this.remove(model, options);
      if (model && event === 'change:' + model.idAttribute) {
        delete this._byId[model.previous(model.idAttribute)];
        if (model.id != null) this._byId[model.id] = model;
      }
      this.trigger.apply(this, arguments);
    }

  });

  // Underscore methods that we want to implement on the Collection.
  // 90% of the core usefulness of Backbone Collections is actually implemented
  // right here:
  var methods = ['forEach', 'each', 'map', 'collect', 'reduce', 'foldl',
    'inject', 'reduceRight', 'foldr', 'find', 'detect', 'filter', 'select',
    'reject', 'every', 'all', 'some', 'any', 'include', 'contains', 'invoke',
    'max', 'min', 'toArray', 'size', 'first', 'head', 'take', 'initial', 'rest',
    'tail', 'drop', 'last', 'without', 'difference', 'indexOf', 'shuffle',
    'lastIndexOf', 'isEmpty', 'chain', 'sample'];

  // Mix in each Underscore method as a proxy to `Collection#models`.
  _.each(methods, function(method) {
    Collection.prototype[method] = function() {
      var args = slice.call(arguments);
      args.unshift(this.models);
      return _[method].apply(_, args);
    };
  });

  // Underscore methods that take a property name as an argument.
  var attributeMethods = ['groupBy', 'countBy', 'sortBy', 'indexBy'];

  // Use attributes instead of properties.
  _.each(attributeMethods, function(method) {
    Collection.prototype[method] = function(value, context) {
      var iterator = _.isFunction(value) ? value : function(model) {
        return model.get(value);
      };
      return _[method](this.models, iterator, context);
    };
  });

  // Backbone.View
  // -------------

  // Backbone Views are almost more convention than they are actual code. A View
  // is simply a JavaScript object that represents a logical chunk of UI in the
  // DOM. This might be a single item, an entire list, a sidebar or panel, or
  // even the surrounding frame which wraps your whole app. Defining a chunk of
  // UI as a **View** allows you to define your DOM events declaratively, without
  // having to worry about render order ... and makes it easy for the view to
  // react to specific changes in the state of your models.

  // Creating a Backbone.View creates its initial element outside of the DOM,
  // if an existing element is not provided...
  var View = Backbone.View = function(options) {
    this.cid = _.uniqueId('view');
    options || (options = {});
    _.extend(this, _.pick(options, viewOptions));
    this._ensureElement();
    this.initialize.apply(this, arguments);
    this.delegateEvents();
  };

  // Cached regex to split keys for `delegate`.
  var delegateEventSplitter = /^(\S+)\s*(.*)$/;

  // List of view options to be merged as properties.
  var viewOptions = ['model', 'collection', 'el', 'id', 'attributes', 'className', 'tagName', 'events'];

  // Set up all inheritable **Backbone.View** properties and methods.
  _.extend(View.prototype, Events, {

    // The default `tagName` of a View's element is `"div"`.
    tagName: 'div',

    // jQuery delegate for element lookup, scoped to DOM elements within the
    // current view. This should be preferred to global lookups where possible.
    $: function(selector) {
      return this.$el.find(selector);
    },

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // **render** is the core function that your view should override, in order
    // to populate its element (`this.el`), with the appropriate HTML. The
    // convention is for **render** to always return `this`.
    render: function() {
      return this;
    },

    // Remove this view by taking the element out of the DOM, and removing any
    // applicable Backbone.Events listeners.
    remove: function() {
      this.$el.remove();
      this.stopListening();
      return this;
    },

    // Change the view's element (`this.el` property), including event
    // re-delegation.
    setElement: function(element, delegate) {
      if (this.$el) this.undelegateEvents();
      this.$el = element instanceof Backbone.$ ? element : Backbone.$(element);
      this.el = this.$el[0];
      if (delegate !== false) this.delegateEvents();
      return this;
    },

    // Set callbacks, where `this.events` is a hash of
    //
    // *{"event selector": "callback"}*
    //
    //     {
    //       'mousedown .title':  'edit',
    //       'click .button':     'save',
    //       'click .open':       function(e) { ... }
    //     }
    //
    // pairs. Callbacks will be bound to the view, with `this` set properly.
    // Uses event delegation for efficiency.
    // Omitting the selector binds the event to `this.el`.
    // This only works for delegate-able events: not `focus`, `blur`, and
    // not `change`, `submit`, and `reset` in Internet Explorer.
    delegateEvents: function(events) {
      if (!(events || (events = _.result(this, 'events')))) return this;
      this.undelegateEvents();
      for (var key in events) {
        var method = events[key];
        if (!_.isFunction(method)) method = this[events[key]];
        if (!method) continue;

        var match = key.match(delegateEventSplitter);
        var eventName = match[1], selector = match[2];
        method = _.bind(method, this);
        eventName += '.delegateEvents' + this.cid;
        if (selector === '') {
          this.$el.on(eventName, method);
        } else {
          this.$el.on(eventName, selector, method);
        }
      }
      return this;
    },

    // Clears all callbacks previously bound to the view with `delegateEvents`.
    // You usually don't need to use this, but may wish to if you have multiple
    // Backbone views attached to the same DOM element.
    undelegateEvents: function() {
      this.$el.off('.delegateEvents' + this.cid);
      return this;
    },

    // Ensure that the View has a DOM element to render into.
    // If `this.el` is a string, pass it through `$()`, take the first
    // matching element, and re-assign it to `el`. Otherwise, create
    // an element from the `id`, `className` and `tagName` properties.
    _ensureElement: function() {
      if (!this.el) {
        var attrs = _.extend({}, _.result(this, 'attributes'));
        if (this.id) attrs.id = _.result(this, 'id');
        if (this.className) attrs['class'] = _.result(this, 'className');
        var $el = Backbone.$('<' + _.result(this, 'tagName') + '>').attr(attrs);
        this.setElement($el, false);
      } else {
        this.setElement(_.result(this, 'el'), false);
      }
    }

  });

  // Backbone.sync
  // -------------

  // Override this function to change the manner in which Backbone persists
  // models to the server. You will be passed the type of request, and the
  // model in question. By default, makes a RESTful Ajax request
  // to the model's `url()`. Some possible customizations could be:
  //
  // * Use `setTimeout` to batch rapid-fire updates into a single request.
  // * Send up the models as XML instead of JSON.
  // * Persist models via WebSockets instead of Ajax.
  //
  // Turn on `Backbone.emulateHTTP` in order to send `PUT` and `DELETE` requests
  // as `POST`, with a `_method` parameter containing the true HTTP method,
  // as well as all requests with the body as `application/x-www-form-urlencoded`
  // instead of `application/json` with the model in a param named `model`.
  // Useful when interfacing with server-side languages like **PHP** that make
  // it difficult to read the body of `PUT` requests.
  Backbone.sync = function(method, model, options) {
    var type = methodMap[method];

    // Default options, unless specified.
    _.defaults(options || (options = {}), {
      emulateHTTP: Backbone.emulateHTTP,
      emulateJSON: Backbone.emulateJSON
    });

    // Default JSON-request options.
    var params = {type: type, dataType: 'json'};

    // Ensure that we have a URL.
    if (!options.url) {
      params.url = _.result(model, 'url') || urlError();
    }

    // Ensure that we have the appropriate request data.
    if (options.data == null && model && (method === 'create' || method === 'update' || method === 'patch')) {
      params.contentType = 'application/json';
      params.data = JSON.stringify(options.attrs || model.toJSON(options));
    }

    // For older servers, emulate JSON by encoding the request into an HTML-form.
    if (options.emulateJSON) {
      params.contentType = 'application/x-www-form-urlencoded';
      params.data = params.data ? {model: params.data} : {};
    }

    // For older servers, emulate HTTP by mimicking the HTTP method with `_method`
    // And an `X-HTTP-Method-Override` header.
    if (options.emulateHTTP && (type === 'PUT' || type === 'DELETE' || type === 'PATCH')) {
      params.type = 'POST';
      if (options.emulateJSON) params.data._method = type;
      var beforeSend = options.beforeSend;
      options.beforeSend = function(xhr) {
        xhr.setRequestHeader('X-HTTP-Method-Override', type);
        if (beforeSend) return beforeSend.apply(this, arguments);
      };
    }

    // Don't process data on a non-GET request.
    if (params.type !== 'GET' && !options.emulateJSON) {
      params.processData = false;
    }

    // If we're sending a `PATCH` request, and we're in an old Internet Explorer
    // that still has ActiveX enabled by default, override jQuery to use that
    // for XHR instead. Remove this line when jQuery supports `PATCH` on IE8.
    if (params.type === 'PATCH' && noXhrPatch) {
      params.xhr = function() {
        return new ActiveXObject("Microsoft.XMLHTTP");
      };
    }

    // Make the request, allowing the user to override any Ajax options.
    var xhr = options.xhr = Backbone.ajax(_.extend(params, options));
    model.trigger('request', model, xhr, options);
    return xhr;
  };

  var noXhrPatch =
    typeof window !== 'undefined' && !!window.ActiveXObject &&
      !(window.XMLHttpRequest && (new XMLHttpRequest).dispatchEvent);

  // Map from CRUD to HTTP for our default `Backbone.sync` implementation.
  var methodMap = {
    'create': 'POST',
    'update': 'PUT',
    'patch':  'PATCH',
    'delete': 'DELETE',
    'read':   'GET'
  };

  // Set the default implementation of `Backbone.ajax` to proxy through to `$`.
  // Override this if you'd like to use a different library.
  Backbone.ajax = function() {
    return Backbone.$.ajax.apply(Backbone.$, arguments);
  };

  // Backbone.Router
  // ---------------

  // Routers map faux-URLs to actions, and fire events when routes are
  // matched. Creating a new one sets its `routes` hash, if not set statically.
  var Router = Backbone.Router = function(options) {
    options || (options = {});
    if (options.routes) this.routes = options.routes;
    this._bindRoutes();
    this.initialize.apply(this, arguments);
  };

  // Cached regular expressions for matching named param parts and splatted
  // parts of route strings.
  var optionalParam = /\((.*?)\)/g;
  var namedParam    = /(\(\?)?:\w+/g;
  var splatParam    = /\*\w+/g;
  var escapeRegExp  = /[\-{}\[\]+?.,\\\^$|#\s]/g;

  // Set up all inheritable **Backbone.Router** properties and methods.
  _.extend(Router.prototype, Events, {

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // Manually bind a single named route to a callback. For example:
    //
    //     this.route('search/:query/p:num', 'search', function(query, num) {
    //       ...
    //     });
    //
    route: function(route, name, callback) {
      if (!_.isRegExp(route)) route = this._routeToRegExp(route);
      if (_.isFunction(name)) {
        callback = name;
        name = '';
      }
      if (!callback) callback = this[name];
      var router = this;
      Backbone.history.route(route, function(fragment) {
        var args = router._extractParameters(route, fragment);
        router.execute(callback, args);
        router.trigger.apply(router, ['route:' + name].concat(args));
        router.trigger('route', name, args);
        Backbone.history.trigger('route', router, name, args);
      });
      return this;
    },

    // Execute a route handler with the provided parameters.  This is an
    // excellent place to do pre-route setup or post-route cleanup.
    execute: function(callback, args) {
      if (callback) callback.apply(this, args);
    },

    // Simple proxy to `Backbone.history` to save a fragment into the history.
    navigate: function(fragment, options) {
      Backbone.history.navigate(fragment, options);
      return this;
    },

    // Bind all defined routes to `Backbone.history`. We have to reverse the
    // order of the routes here to support behavior where the most general
    // routes can be defined at the bottom of the route map.
    _bindRoutes: function() {
      if (!this.routes) return;
      this.routes = _.result(this, 'routes');
      var route, routes = _.keys(this.routes);
      while ((route = routes.pop()) != null) {
        this.route(route, this.routes[route]);
      }
    },

    // Convert a route string into a regular expression, suitable for matching
    // against the current location hash.
    _routeToRegExp: function(route) {
      route = route.replace(escapeRegExp, '\\$&')
                   .replace(optionalParam, '(?:$1)?')
                   .replace(namedParam, function(match, optional) {
                     return optional ? match : '([^/?]+)';
                   })
                   .replace(splatParam, '([^?]*?)');
      return new RegExp('^' + route + '(?:\\?([\\s\\S]*))?$');
    },

    // Given a route, and a URL fragment that it matches, return the array of
    // extracted decoded parameters. Empty or unmatched parameters will be
    // treated as `null` to normalize cross-browser behavior.
    _extractParameters: function(route, fragment) {
      var params = route.exec(fragment).slice(1);
      return _.map(params, function(param, i) {
        // Don't decode the search params.
        if (i === params.length - 1) return param || null;
        return param ? decodeURIComponent(param) : null;
      });
    }

  });

  // Backbone.History
  // ----------------

  // Handles cross-browser history management, based on either
  // [pushState](http://diveintohtml5.info/history.html) and real URLs, or
  // [onhashchange](https://developer.mozilla.org/en-US/docs/DOM/window.onhashchange)
  // and URL fragments. If the browser supports neither (old IE, natch),
  // falls back to polling.
  var History = Backbone.History = function() {
    this.handlers = [];
    _.bindAll(this, 'checkUrl');

    // Ensure that `History` can be used outside of the browser.
    if (typeof window !== 'undefined') {
      this.location = window.location;
      this.history = window.history;
    }
  };

  // Cached regex for stripping a leading hash/slash and trailing space.
  var routeStripper = /^[#\/]|\s+$/g;

  // Cached regex for stripping leading and trailing slashes.
  var rootStripper = /^\/+|\/+$/g;

  // Cached regex for detecting MSIE.
  var isExplorer = /msie [\w.]+/;

  // Cached regex for removing a trailing slash.
  var trailingSlash = /\/$/;

  // Cached regex for stripping urls of hash.
  var pathStripper = /#.*$/;

  // Has the history handling already been started?
  History.started = false;

  // Set up all inheritable **Backbone.History** properties and methods.
  _.extend(History.prototype, Events, {

    // The default interval to poll for hash changes, if necessary, is
    // twenty times a second.
    interval: 50,

    // Are we at the app root?
    atRoot: function() {
      return this.location.pathname.replace(/[^\/]$/, '$&/') === this.root;
    },

    // Gets the true hash value. Cannot use location.hash directly due to bug
    // in Firefox where location.hash will always be decoded.
    getHash: function(window) {
      var match = (window || this).location.href.match(/#(.*)$/);
      return match ? match[1] : '';
    },

    // Get the cross-browser normalized URL fragment, either from the URL,
    // the hash, or the override.
    getFragment: function(fragment, forcePushState) {
      if (fragment == null) {
        if (this._hasPushState || !this._wantsHashChange || forcePushState) {
          fragment = decodeURI(this.location.pathname + this.location.search);
          var root = this.root.replace(trailingSlash, '');
          if (!fragment.indexOf(root)) fragment = fragment.slice(root.length);
        } else {
          fragment = this.getHash();
        }
      }
      return fragment.replace(routeStripper, '');
    },

    // Start the hash change handling, returning `true` if the current URL matches
    // an existing route, and `false` otherwise.
    start: function(options) {
      if (History.started) throw new Error("Backbone.history has already been started");
      History.started = true;

      // Figure out the initial configuration. Do we need an iframe?
      // Is pushState desired ... is it available?
      this.options          = _.extend({root: '/'}, this.options, options);
      this.root             = this.options.root;
      this._wantsHashChange = this.options.hashChange !== false;
      this._wantsPushState  = !!this.options.pushState;
      this._hasPushState    = !!(this.options.pushState && this.history && this.history.pushState);
      var fragment          = this.getFragment();
      var docMode           = document.documentMode;
      var oldIE             = (isExplorer.exec(navigator.userAgent.toLowerCase()) && (!docMode || docMode <= 7));

      // Normalize root to always include a leading and trailing slash.
      this.root = ('/' + this.root + '/').replace(rootStripper, '/');

      if (oldIE && this._wantsHashChange) {
        var frame = Backbone.$('<iframe src="javascript:0" tabindex="-1">');
        this.iframe = frame.hide().appendTo('body')[0].contentWindow;
        this.navigate(fragment);
      }

      // Depending on whether we're using pushState or hashes, and whether
      // 'onhashchange' is supported, determine how we check the URL state.
      if (this._hasPushState) {
        Backbone.$(window).on('popstate', this.checkUrl);
      } else if (this._wantsHashChange && ('onhashchange' in window) && !oldIE) {
        Backbone.$(window).on('hashchange', this.checkUrl);
      } else if (this._wantsHashChange) {
        this._checkUrlInterval = setInterval(this.checkUrl, this.interval);
      }

      // Determine if we need to change the base url, for a pushState link
      // opened by a non-pushState browser.
      this.fragment = fragment;
      var loc = this.location;

      // Transition from hashChange to pushState or vice versa if both are
      // requested.
      if (this._wantsHashChange && this._wantsPushState) {

        // If we've started off with a route from a `pushState`-enabled
        // browser, but we're currently in a browser that doesn't support it...
        if (!this._hasPushState && !this.atRoot()) {
          this.fragment = this.getFragment(null, true);
          this.location.replace(this.root + '#' + this.fragment);
          // Return immediately as browser will do redirect to new url
          return true;

        // Or if we've started out with a hash-based route, but we're currently
        // in a browser where it could be `pushState`-based instead...
        } else if (this._hasPushState && this.atRoot() && loc.hash) {
          this.fragment = this.getHash().replace(routeStripper, '');
          this.history.replaceState({}, document.title, this.root + this.fragment);
        }

      }

      if (!this.options.silent) return this.loadUrl();
    },

    // Disable Backbone.history, perhaps temporarily. Not useful in a real app,
    // but possibly useful for unit testing Routers.
    stop: function() {
      Backbone.$(window).off('popstate', this.checkUrl).off('hashchange', this.checkUrl);
      if (this._checkUrlInterval) clearInterval(this._checkUrlInterval);
      History.started = false;
    },

    // Add a route to be tested when the fragment changes. Routes added later
    // may override previous routes.
    route: function(route, callback) {
      this.handlers.unshift({route: route, callback: callback});
    },

    // Checks the current URL to see if it has changed, and if it has,
    // calls `loadUrl`, normalizing across the hidden iframe.
    checkUrl: function(e) {
      var current = this.getFragment();
      if (current === this.fragment && this.iframe) {
        current = this.getFragment(this.getHash(this.iframe));
      }
      if (current === this.fragment) return false;
      if (this.iframe) this.navigate(current);
      this.loadUrl();
    },

    // Attempt to load the current URL fragment. If a route succeeds with a
    // match, returns `true`. If no defined routes matches the fragment,
    // returns `false`.
    loadUrl: function(fragment) {
      fragment = this.fragment = this.getFragment(fragment);
      return _.any(this.handlers, function(handler) {
        if (handler.route.test(fragment)) {
          handler.callback(fragment);
          return true;
        }
      });
    },

    // Save a fragment into the hash history, or replace the URL state if the
    // 'replace' option is passed. You are responsible for properly URL-encoding
    // the fragment in advance.
    //
    // The options object can contain `trigger: true` if you wish to have the
    // route callback be fired (not usually desirable), or `replace: true`, if
    // you wish to modify the current URL without adding an entry to the history.
    navigate: function(fragment, options) {
      if (!History.started) return false;
      if (!options || options === true) options = {trigger: !!options};

      var url = this.root + (fragment = this.getFragment(fragment || ''));

      // Strip the hash for matching.
      fragment = fragment.replace(pathStripper, '');

      if (this.fragment === fragment) return;
      this.fragment = fragment;

      // Don't include a trailing slash on the root.
      if (fragment === '' && url !== '/') url = url.slice(0, -1);

      // If pushState is available, we use it to set the fragment as a real URL.
      if (this._hasPushState) {
        this.history[options.replace ? 'replaceState' : 'pushState']({}, document.title, url);

      // If hash changes haven't been explicitly disabled, update the hash
      // fragment to store history.
      } else if (this._wantsHashChange) {
        this._updateHash(this.location, fragment, options.replace);
        if (this.iframe && (fragment !== this.getFragment(this.getHash(this.iframe)))) {
          // Opening and closing the iframe tricks IE7 and earlier to push a
          // history entry on hash-tag change.  When replace is true, we don't
          // want this.
          if(!options.replace) this.iframe.document.open().close();
          this._updateHash(this.iframe.location, fragment, options.replace);
        }

      // If you've told us that you explicitly don't want fallback hashchange-
      // based history, then `navigate` becomes a page refresh.
      } else {
        return this.location.assign(url);
      }
      if (options.trigger) return this.loadUrl(fragment);
    },

    // Update the hash location, either replacing the current entry, or adding
    // a new one to the browser history.
    _updateHash: function(location, fragment, replace) {
      if (replace) {
        var href = location.href.replace(/(javascript:|#).*$/, '');
        location.replace(href + '#' + fragment);
      } else {
        // Some browsers require that `hash` contains a leading #.
        location.hash = '#' + fragment;
      }
    }

  });

  // Create the default Backbone.history.
  Backbone.history = new History;

  // Helpers
  // -------

  // Helper function to correctly set up the prototype chain, for subclasses.
  // Similar to `goog.inherits`, but uses a hash of prototype properties and
  // class properties to be extended.
  var extend = function(protoProps, staticProps) {
    var parent = this;
    var child;

    // The constructor function for the new subclass is either defined by you
    // (the "constructor" property in your `extend` definition), or defaulted
    // by us to simply call the parent's constructor.
    if (protoProps && _.has(protoProps, 'constructor')) {
      child = protoProps.constructor;
    } else {
      child = function(){ return parent.apply(this, arguments); };
    }

    // Add static properties to the constructor function, if supplied.
    _.extend(child, parent, staticProps);

    // Set the prototype chain to inherit from `parent`, without calling
    // `parent`'s constructor function.
    var Surrogate = function(){ this.constructor = child; };
    Surrogate.prototype = parent.prototype;
    child.prototype = new Surrogate;

    // Add prototype properties (instance properties) to the subclass,
    // if supplied.
    if (protoProps) _.extend(child.prototype, protoProps);

    // Set a convenience property in case the parent's prototype is needed
    // later.
    child.__super__ = parent.prototype;

    return child;
  };

  // Set up inheritance for the model, collection, router, view and history.
  Model.extend = Collection.extend = Router.extend = View.extend = History.extend = extend;

  // Throw an error when a URL is needed, and none is supplied.
  var urlError = function() {
    throw new Error('A "url" property or function must be specified');
  };

  // Wrap an optional error callback with a fallback error event.
  var wrapError = function(model, options) {
    var error = options.error;
    options.error = function(resp) {
      if (error) error(model, resp, options);
      model.trigger('error', model, resp, options);
    };
  };

  return Backbone;

}));

// MarionetteJS (Backbone.Marionette)
// ----------------------------------
// v1.8.8
//
// Copyright (c)2014 Derick Bailey, Muted Solutions, LLC.
// Distributed under MIT license
//
// http://marionettejs.com


/*!
 * Includes BabySitter
 * https://github.com/marionettejs/backbone.babysitter/
 *
 * Includes Wreqr
 * https://github.com/marionettejs/backbone.wreqr/
 */


var Marionette = (function(global, Backbone, _){
  "use strict";

  // Backbone.BabySitter
  // -------------------
  // v0.1.4
  //
  // Copyright (c)2014 Derick Bailey, Muted Solutions, LLC.
  // Distributed under MIT license
  //
  // http://github.com/marionettejs/backbone.babysitter
  (function(Backbone, _) {
    "use strict";
    var previousChildViewContainer = Backbone.ChildViewContainer;
    // BabySitter.ChildViewContainer
    // -----------------------------
    //
    // Provide a container to store, retrieve and
    // shut down child views.
    Backbone.ChildViewContainer = function(Backbone, _) {
      // Container Constructor
      // ---------------------
      var Container = function(views) {
        this._views = {};
        this._indexByModel = {};
        this._indexByCustom = {};
        this._updateLength();
        _.each(views, this.add, this);
      };
      // Container Methods
      // -----------------
      _.extend(Container.prototype, {
        // Add a view to this container. Stores the view
        // by `cid` and makes it searchable by the model
        // cid (and model itself). Optionally specify
        // a custom key to store an retrieve the view.
        add: function(view, customIndex) {
          var viewCid = view.cid;
          // store the view
          this._views[viewCid] = view;
          // index it by model
          if (view.model) {
            this._indexByModel[view.model.cid] = viewCid;
          }
          // index by custom
          if (customIndex) {
            this._indexByCustom[customIndex] = viewCid;
          }
          this._updateLength();
          return this;
        },
        // Find a view by the model that was attached to
        // it. Uses the model's `cid` to find it.
        findByModel: function(model) {
          return this.findByModelCid(model.cid);
        },
        // Find a view by the `cid` of the model that was attached to
        // it. Uses the model's `cid` to find the view `cid` and
        // retrieve the view using it.
        findByModelCid: function(modelCid) {
          var viewCid = this._indexByModel[modelCid];
          return this.findByCid(viewCid);
        },
        // Find a view by a custom indexer.
        findByCustom: function(index) {
          var viewCid = this._indexByCustom[index];
          return this.findByCid(viewCid);
        },
        // Find by index. This is not guaranteed to be a
        // stable index.
        findByIndex: function(index) {
          return _.values(this._views)[index];
        },
        // retrieve a view by its `cid` directly
        findByCid: function(cid) {
          return this._views[cid];
        },
        // Remove a view
        remove: function(view) {
          var viewCid = view.cid;
          // delete model index
          if (view.model) {
            delete this._indexByModel[view.model.cid];
          }
          // delete custom index
          _.any(this._indexByCustom, function(cid, key) {
            if (cid === viewCid) {
              delete this._indexByCustom[key];
              return true;
            }
          }, this);
          // remove the view from the container
          delete this._views[viewCid];
          // update the length
          this._updateLength();
          return this;
        },
        // Call a method on every view in the container,
        // passing parameters to the call method one at a
        // time, like `function.call`.
        call: function(method) {
          this.apply(method, _.tail(arguments));
        },
        // Apply a method on every view in the container,
        // passing parameters to the call method one at a
        // time, like `function.apply`.
        apply: function(method, args) {
          _.each(this._views, function(view) {
            if (_.isFunction(view[method])) {
              view[method].apply(view, args || []);
            }
          });
        },
        // Update the `.length` attribute on this container
        _updateLength: function() {
          this.length = _.size(this._views);
        }
      });
      // Borrowing this code from Backbone.Collection:
      // http://backbonejs.org/docs/backbone.html#section-106
      //
      // Mix in methods from Underscore, for iteration, and other
      // collection related features.
      var methods = [ "forEach", "each", "map", "find", "detect", "filter", "select", "reject", "every", "all", "some", "any", "include", "contains", "invoke", "toArray", "first", "initial", "rest", "last", "without", "isEmpty", "pluck" ];
      _.each(methods, function(method) {
        Container.prototype[method] = function() {
          var views = _.values(this._views);
          var args = [ views ].concat(_.toArray(arguments));
          return _[method].apply(_, args);
        };
      });
      // return the public API
      return Container;
    }(Backbone, _);
    Backbone.ChildViewContainer.VERSION = "0.1.4";
    Backbone.ChildViewContainer.noConflict = function() {
      Backbone.ChildViewContainer = previousChildViewContainer;
      return this;
    };
    return Backbone.ChildViewContainer;
  })(Backbone, _);
  // Backbone.Wreqr (Backbone.Marionette)
  // ----------------------------------
  // v1.3.1
  //
  // Copyright (c)2014 Derick Bailey, Muted Solutions, LLC.
  // Distributed under MIT license
  //
  // http://github.com/marionettejs/backbone.wreqr
  (function(Backbone, _) {
    "use strict";
    var previousWreqr = Backbone.Wreqr;
    var Wreqr = Backbone.Wreqr = {};
    Backbone.Wreqr.VERSION = "1.3.1";
    Backbone.Wreqr.noConflict = function() {
      Backbone.Wreqr = previousWreqr;
      return this;
    };
    // Handlers
    // --------
    // A registry of functions to call, given a name
    Wreqr.Handlers = function(Backbone, _) {
      "use strict";
      // Constructor
      // -----------
      var Handlers = function(options) {
        this.options = options;
        this._wreqrHandlers = {};
        if (_.isFunction(this.initialize)) {
          this.initialize(options);
        }
      };
      Handlers.extend = Backbone.Model.extend;
      // Instance Members
      // ----------------
      _.extend(Handlers.prototype, Backbone.Events, {
        // Add multiple handlers using an object literal configuration
        setHandlers: function(handlers) {
          _.each(handlers, function(handler, name) {
            var context = null;
            if (_.isObject(handler) && !_.isFunction(handler)) {
              context = handler.context;
              handler = handler.callback;
            }
            this.setHandler(name, handler, context);
          }, this);
        },
        // Add a handler for the given name, with an
        // optional context to run the handler within
        setHandler: function(name, handler, context) {
          var config = {
            callback: handler,
            context: context
          };
          this._wreqrHandlers[name] = config;
          this.trigger("handler:add", name, handler, context);
        },
        // Determine whether or not a handler is registered
        hasHandler: function(name) {
          return !!this._wreqrHandlers[name];
        },
        // Get the currently registered handler for
        // the specified name. Throws an exception if
        // no handler is found.
        getHandler: function(name) {
          var config = this._wreqrHandlers[name];
          if (!config) {
            return;
          }
          return function() {
            var args = Array.prototype.slice.apply(arguments);
            return config.callback.apply(config.context, args);
          };
        },
        // Remove a handler for the specified name
        removeHandler: function(name) {
          delete this._wreqrHandlers[name];
        },
        // Remove all handlers from this registry
        removeAllHandlers: function() {
          this._wreqrHandlers = {};
        }
      });
      return Handlers;
    }(Backbone, _);
    // Wreqr.CommandStorage
    // --------------------
    //
    // Store and retrieve commands for execution.
    Wreqr.CommandStorage = function() {
      "use strict";
      // Constructor function
      var CommandStorage = function(options) {
        this.options = options;
        this._commands = {};
        if (_.isFunction(this.initialize)) {
          this.initialize(options);
        }
      };
      // Instance methods
      _.extend(CommandStorage.prototype, Backbone.Events, {
        // Get an object literal by command name, that contains
        // the `commandName` and the `instances` of all commands
        // represented as an array of arguments to process
        getCommands: function(commandName) {
          var commands = this._commands[commandName];
          // we don't have it, so add it
          if (!commands) {
            // build the configuration
            commands = {
              command: commandName,
              instances: []
            };
            // store it
            this._commands[commandName] = commands;
          }
          return commands;
        },
        // Add a command by name, to the storage and store the
        // args for the command
        addCommand: function(commandName, args) {
          var command = this.getCommands(commandName);
          command.instances.push(args);
        },
        // Clear all commands for the given `commandName`
        clearCommands: function(commandName) {
          var command = this.getCommands(commandName);
          command.instances = [];
        }
      });
      return CommandStorage;
    }();
    // Wreqr.Commands
    // --------------
    //
    // A simple command pattern implementation. Register a command
    // handler and execute it.
    Wreqr.Commands = function(Wreqr) {
      "use strict";
      return Wreqr.Handlers.extend({
        // default storage type
        storageType: Wreqr.CommandStorage,
        constructor: function(options) {
          this.options = options || {};
          this._initializeStorage(this.options);
          this.on("handler:add", this._executeCommands, this);
          var args = Array.prototype.slice.call(arguments);
          Wreqr.Handlers.prototype.constructor.apply(this, args);
        },
        // Execute a named command with the supplied args
        execute: function(name, args) {
          name = arguments[0];
          args = Array.prototype.slice.call(arguments, 1);
          if (this.hasHandler(name)) {
            this.getHandler(name).apply(this, args);
          } else {
            this.storage.addCommand(name, args);
          }
        },
        // Internal method to handle bulk execution of stored commands
        _executeCommands: function(name, handler, context) {
          var command = this.storage.getCommands(name);
          // loop through and execute all the stored command instances
          _.each(command.instances, function(args) {
            handler.apply(context, args);
          });
          this.storage.clearCommands(name);
        },
        // Internal method to initialize storage either from the type's
        // `storageType` or the instance `options.storageType`.
        _initializeStorage: function(options) {
          var storage;
          var StorageType = options.storageType || this.storageType;
          if (_.isFunction(StorageType)) {
            storage = new StorageType();
          } else {
            storage = StorageType;
          }
          this.storage = storage;
        }
      });
    }(Wreqr);
    // Wreqr.RequestResponse
    // ---------------------
    //
    // A simple request/response implementation. Register a
    // request handler, and return a response from it
    Wreqr.RequestResponse = function(Wreqr) {
      "use strict";
      return Wreqr.Handlers.extend({
        request: function() {
          var name = arguments[0];
          var args = Array.prototype.slice.call(arguments, 1);
          if (this.hasHandler(name)) {
            return this.getHandler(name).apply(this, args);
          }
        }
      });
    }(Wreqr);
    // Event Aggregator
    // ----------------
    // A pub-sub object that can be used to decouple various parts
    // of an application through event-driven architecture.
    Wreqr.EventAggregator = function(Backbone, _) {
      "use strict";
      var EA = function() {};
      // Copy the `extend` function used by Backbone's classes
      EA.extend = Backbone.Model.extend;
      // Copy the basic Backbone.Events on to the event aggregator
      _.extend(EA.prototype, Backbone.Events);
      return EA;
    }(Backbone, _);
    // Wreqr.Channel
    // --------------
    //
    // An object that wraps the three messaging systems:
    // EventAggregator, RequestResponse, Commands
    Wreqr.Channel = function(Wreqr) {
      "use strict";
      var Channel = function(channelName) {
        this.vent = new Backbone.Wreqr.EventAggregator();
        this.reqres = new Backbone.Wreqr.RequestResponse();
        this.commands = new Backbone.Wreqr.Commands();
        this.channelName = channelName;
      };
      _.extend(Channel.prototype, {
        // Remove all handlers from the messaging systems of this channel
        reset: function() {
          this.vent.off();
          this.vent.stopListening();
          this.reqres.removeAllHandlers();
          this.commands.removeAllHandlers();
          return this;
        },
        // Connect a hash of events; one for each messaging system
        connectEvents: function(hash, context) {
          this._connect("vent", hash, context);
          return this;
        },
        connectCommands: function(hash, context) {
          this._connect("commands", hash, context);
          return this;
        },
        connectRequests: function(hash, context) {
          this._connect("reqres", hash, context);
          return this;
        },
        // Attach the handlers to a given message system `type`
        _connect: function(type, hash, context) {
          if (!hash) {
            return;
          }
          context = context || this;
          var method = type === "vent" ? "on" : "setHandler";
          _.each(hash, function(fn, eventName) {
            this[type][method](eventName, _.bind(fn, context));
          }, this);
        }
      });
      return Channel;
    }(Wreqr);
    // Wreqr.Radio
    // --------------
    //
    // An object that lets you communicate with many channels.
    Wreqr.radio = function(Wreqr) {
      "use strict";
      var Radio = function() {
        this._channels = {};
        this.vent = {};
        this.commands = {};
        this.reqres = {};
        this._proxyMethods();
      };
      _.extend(Radio.prototype, {
        channel: function(channelName) {
          if (!channelName) {
            throw new Error("Channel must receive a name");
          }
          return this._getChannel(channelName);
        },
        _getChannel: function(channelName) {
          var channel = this._channels[channelName];
          if (!channel) {
            channel = new Wreqr.Channel(channelName);
            this._channels[channelName] = channel;
          }
          return channel;
        },
        _proxyMethods: function() {
          _.each([ "vent", "commands", "reqres" ], function(system) {
            _.each(messageSystems[system], function(method) {
              this[system][method] = proxyMethod(this, system, method);
            }, this);
          }, this);
        }
      });
      var messageSystems = {
        vent: [ "on", "off", "trigger", "once", "stopListening", "listenTo", "listenToOnce" ],
        commands: [ "execute", "setHandler", "setHandlers", "removeHandler", "removeAllHandlers" ],
        reqres: [ "request", "setHandler", "setHandlers", "removeHandler", "removeAllHandlers" ]
      };
      var proxyMethod = function(radio, system, method) {
        return function(channelName) {
          var messageSystem = radio._getChannel(channelName)[system];
          var args = Array.prototype.slice.call(arguments, 1);
          return messageSystem[method].apply(messageSystem, args);
        };
      };
      return new Radio();
    }(Wreqr);
    return Backbone.Wreqr;
  })(Backbone, _);

  // Define and export the Marionette namespace
  var Marionette = {};
  Backbone.Marionette = Marionette;

  // Get the DOM manipulator for later use
  Marionette.$ = Backbone.$;

// Helpers
// -------

// For slicing `arguments` in functions
var slice = Array.prototype.slice;

function throwError(message, name) {
  var error = new Error(message);
  error.name = name || 'Error';
  throw error;
}

// Marionette.extend
// -----------------

// Borrow the Backbone `extend` method so we can use it as needed
Marionette.extend = Backbone.Model.extend;

// Marionette.getOption
// --------------------

// Retrieve an object, function or other value from a target
// object or its `options`, with `options` taking precedence.
Marionette.getOption = function(target, optionName){
  if (!target || !optionName){ return; }
  var value;

  if (target.options && (optionName in target.options) && (target.options[optionName] !== undefined)){
    value = target.options[optionName];
  } else {
    value = target[optionName];
  }

  return value;
};

// Marionette.normalizeMethods
// ----------------------

// Pass in a mapping of events => functions or function names
// and return a mapping of events => functions
Marionette.normalizeMethods = function(hash) {
  var normalizedHash = {}, method;
  _.each(hash, function(fn, name) {
    method = fn;
    if (!_.isFunction(method)) {
      method = this[method];
    }
    if (!method) {
      return;
    }
    normalizedHash[name] = method;
  }, this);
  return normalizedHash;
};


// allows for the use of the @ui. syntax within
// a given key for triggers and events
// swaps the @ui with the associated selector
Marionette.normalizeUIKeys = function(hash, ui) {
  if (typeof(hash) === "undefined") {
    return;
  }

  _.each(_.keys(hash), function(v) {
    var pattern = /@ui.[a-zA-Z_$0-9]*/g;
    if (v.match(pattern)) {
      hash[v.replace(pattern, function(r) {
        return ui[r.slice(4)];
      })] = hash[v];
      delete hash[v];
    }
  });

  return hash;
};

// Mix in methods from Underscore, for iteration, and other
// collection related features.
// Borrowing this code from Backbone.Collection:
// http://backbonejs.org/docs/backbone.html#section-106
Marionette.actAsCollection = function(object, listProperty) {
  var methods = ['forEach', 'each', 'map', 'find', 'detect', 'filter',
    'select', 'reject', 'every', 'all', 'some', 'any', 'include',
    'contains', 'invoke', 'toArray', 'first', 'initial', 'rest',
    'last', 'without', 'isEmpty', 'pluck'];

  _.each(methods, function(method) {
    object[method] = function() {
      var list = _.values(_.result(this, listProperty));
      var args = [list].concat(_.toArray(arguments));
      return _[method].apply(_, args);
    };
  });
};

// Trigger an event and/or a corresponding method name. Examples:
//
// `this.triggerMethod("foo")` will trigger the "foo" event and
// call the "onFoo" method.
//
// `this.triggerMethod("foo:bar")` will trigger the "foo:bar" event and
// call the "onFooBar" method.
Marionette.triggerMethod = (function(){

  // split the event name on the ":"
  var splitter = /(^|:)(\w)/gi;

  // take the event section ("section1:section2:section3")
  // and turn it in to uppercase name
  function getEventName(match, prefix, eventName) {
    return eventName.toUpperCase();
  }

  // actual triggerMethod implementation
  var triggerMethod = function(event) {
    // get the method name from the event name
    var methodName = 'on' + event.replace(splitter, getEventName);
    var method = this[methodName];

    // trigger the event, if a trigger method exists
    if(_.isFunction(this.trigger)) {
      this.trigger.apply(this, arguments);
    }

    // call the onMethodName if it exists
    if (_.isFunction(method)) {
      // pass all arguments, except the event name
      return method.apply(this, _.tail(arguments));
    }
  };

  return triggerMethod;
})();

// DOMRefresh
// ----------
//
// Monitor a view's state, and after it has been rendered and shown
// in the DOM, trigger a "dom:refresh" event every time it is
// re-rendered.

Marionette.MonitorDOMRefresh = (function(documentElement){
  // track when the view has been shown in the DOM,
  // using a Marionette.Region (or by other means of triggering "show")
  function handleShow(view){
    view._isShown = true;
    triggerDOMRefresh(view);
  }

  // track when the view has been rendered
  function handleRender(view){
    view._isRendered = true;
    triggerDOMRefresh(view);
  }

  // Trigger the "dom:refresh" event and corresponding "onDomRefresh" method
  function triggerDOMRefresh(view){
    if (view._isShown && view._isRendered && isInDOM(view)){
      if (_.isFunction(view.triggerMethod)){
        view.triggerMethod("dom:refresh");
      }
    }
  }

  function isInDOM(view) {
    return documentElement.contains(view.el);
  }

  // Export public API
  return function(view){
    view.listenTo(view, "show", function(){
      handleShow(view);
    });

    view.listenTo(view, "render", function(){
      handleRender(view);
    });
  };
})(document.documentElement);


// Marionette.bindEntityEvents & unbindEntityEvents
// ---------------------------
//
// These methods are used to bind/unbind a backbone "entity" (collection/model)
// to methods on a target object.
//
// The first parameter, `target`, must have a `listenTo` method from the
// EventBinder object.
//
// The second parameter is the entity (Backbone.Model or Backbone.Collection)
// to bind the events from.
//
// The third parameter is a hash of { "event:name": "eventHandler" }
// configuration. Multiple handlers can be separated by a space. A
// function can be supplied instead of a string handler name.

(function(Marionette){
  "use strict";

  // Bind the event to handlers specified as a string of
  // handler names on the target object
  function bindFromStrings(target, entity, evt, methods){
    var methodNames = methods.split(/\s+/);

    _.each(methodNames, function(methodName) {

      var method = target[methodName];
      if(!method) {
        throwError("Method '"+ methodName +"' was configured as an event handler, but does not exist.");
      }

      target.listenTo(entity, evt, method);
    });
  }

  // Bind the event to a supplied callback function
  function bindToFunction(target, entity, evt, method){
      target.listenTo(entity, evt, method);
  }

  // Bind the event to handlers specified as a string of
  // handler names on the target object
  function unbindFromStrings(target, entity, evt, methods){
    var methodNames = methods.split(/\s+/);

    _.each(methodNames, function(methodName) {
      var method = target[methodName];
      target.stopListening(entity, evt, method);
    });
  }

  // Bind the event to a supplied callback function
  function unbindToFunction(target, entity, evt, method){
      target.stopListening(entity, evt, method);
  }


  // generic looping function
  function iterateEvents(target, entity, bindings, functionCallback, stringCallback){
    if (!entity || !bindings) { return; }

    // allow the bindings to be a function
    if (_.isFunction(bindings)){
      bindings = bindings.call(target);
    }

    // iterate the bindings and bind them
    _.each(bindings, function(methods, evt){

      // allow for a function as the handler,
      // or a list of event names as a string
      if (_.isFunction(methods)){
        functionCallback(target, entity, evt, methods);
      } else {
        stringCallback(target, entity, evt, methods);
      }

    });
  }

  // Export Public API
  Marionette.bindEntityEvents = function(target, entity, bindings){
    iterateEvents(target, entity, bindings, bindToFunction, bindFromStrings);
  };

  Marionette.unbindEntityEvents = function(target, entity, bindings){
    iterateEvents(target, entity, bindings, unbindToFunction, unbindFromStrings);
  };

})(Marionette);


// Callbacks
// ---------

// A simple way of managing a collection of callbacks
// and executing them at a later point in time, using jQuery's
// `Deferred` object.
Marionette.Callbacks = function(){
  this._deferred = Marionette.$.Deferred();
  this._callbacks = [];
};

_.extend(Marionette.Callbacks.prototype, {

  // Add a callback to be executed. Callbacks added here are
  // guaranteed to execute, even if they are added after the
  // `run` method is called.
  add: function(callback, contextOverride){
    this._callbacks.push({cb: callback, ctx: contextOverride});

    this._deferred.done(function(context, options){
      if (contextOverride){ context = contextOverride; }
      callback.call(context, options);
    });
  },

  // Run all registered callbacks with the context specified.
  // Additional callbacks can be added after this has been run
  // and they will still be executed.
  run: function(options, context){
    this._deferred.resolve(context, options);
  },

  // Resets the list of callbacks to be run, allowing the same list
  // to be run multiple times - whenever the `run` method is called.
  reset: function(){
    var callbacks = this._callbacks;
    this._deferred = Marionette.$.Deferred();
    this._callbacks = [];

    _.each(callbacks, function(cb){
      this.add(cb.cb, cb.ctx);
    }, this);
  }
});

// Marionette Controller
// ---------------------
//
// A multi-purpose object to use as a controller for
// modules and routers, and as a mediator for workflow
// and coordination of other objects, views, and more.
Marionette.Controller = function(options){
  this.triggerMethod = Marionette.triggerMethod;
  this.options = options || {};

  if (_.isFunction(this.initialize)){
    this.initialize(this.options);
  }
};

Marionette.Controller.extend = Marionette.extend;

// Controller Methods
// --------------

// Ensure it can trigger events with Backbone.Events
_.extend(Marionette.Controller.prototype, Backbone.Events, {
  close: function(){
    this.stopListening();
    var args = Array.prototype.slice.call(arguments);
    this.triggerMethod.apply(this, ["close"].concat(args));
    this.off();
  }
});

// Region
// ------
//
// Manage the visual regions of your composite application. See
// http://lostechies.com/derickbailey/2011/12/12/composite-js-apps-regions-and-region-managers/

Marionette.Region = function(options){
  this.options = options || {};
  this.el = Marionette.getOption(this, "el");

  if (!this.el){
    throwError("An 'el' must be specified for a region.", "NoElError");
  }

  if (this.initialize){
    var args = Array.prototype.slice.apply(arguments);
    this.initialize.apply(this, args);
  }
};


// Region Type methods
// -------------------

_.extend(Marionette.Region, {

  // Build an instance of a region by passing in a configuration object
  // and a default region type to use if none is specified in the config.
  //
  // The config object should either be a string as a jQuery DOM selector,
  // a Region type directly, or an object literal that specifies both
  // a selector and regionType:
  //
  // ```js
  // {
  //   selector: "#foo",
  //   regionType: MyCustomRegion
  // }
  // ```
  //
  buildRegion: function(regionConfig, defaultRegionType){
    var regionIsString = _.isString(regionConfig);
    var regionSelectorIsString = _.isString(regionConfig.selector);
    var regionTypeIsUndefined = _.isUndefined(regionConfig.regionType);
    var regionIsType = _.isFunction(regionConfig);

    if (!regionIsType && !regionIsString && !regionSelectorIsString) {
      throwError("Region must be specified as a Region type, a selector string or an object with selector property");
    }

    var selector, RegionType;

    // get the selector for the region

    if (regionIsString) {
      selector = regionConfig;
    }

    if (regionConfig.selector) {
      selector = regionConfig.selector;
      delete regionConfig.selector;
    }

    // get the type for the region

    if (regionIsType){
      RegionType = regionConfig;
    }

    if (!regionIsType && regionTypeIsUndefined) {
      RegionType = defaultRegionType;
    }

    if (regionConfig.regionType) {
      RegionType = regionConfig.regionType;
      delete regionConfig.regionType;
    }

    if (regionIsString || regionIsType) {
      regionConfig = {};
    }

    regionConfig.el = selector;

    // build the region instance
    var region = new RegionType(regionConfig);

    // override the `getEl` function if we have a parentEl
    // this must be overridden to ensure the selector is found
    // on the first use of the region. if we try to assign the
    // region's `el` to `parentEl.find(selector)` in the object
    // literal to build the region, the element will not be
    // guaranteed to be in the DOM already, and will cause problems
    if (regionConfig.parentEl){
      region.getEl = function(selector) {
        var parentEl = regionConfig.parentEl;
        if (_.isFunction(parentEl)){
          parentEl = parentEl();
        }
        return parentEl.find(selector);
      };
    }

    return region;
  }

});

// Region Instance Methods
// -----------------------

_.extend(Marionette.Region.prototype, Backbone.Events, {

  // Displays a backbone view instance inside of the region.
  // Handles calling the `render` method for you. Reads content
  // directly from the `el` attribute. Also calls an optional
  // `onShow` and `close` method on your view, just after showing
  // or just before closing the view, respectively.
  // The `preventClose` option can be used to prevent a view from being destroyed on show.
  show: function(view, options){
    this.ensureEl();

    var showOptions = options || {};
    var isViewClosed = view.isClosed || _.isUndefined(view.$el);
    var isDifferentView = view !== this.currentView;
    var preventClose =  !!showOptions.preventClose;

    // only close the view if we don't want to preventClose and the view is different
    var _shouldCloseView = !preventClose && isDifferentView;

    if (_shouldCloseView) {
      this.close();
    }

    view.render();
    Marionette.triggerMethod.call(this, "before:show", view);

    if (_.isFunction(view.triggerMethod)) {
      view.triggerMethod("before:show");
    } else {
      Marionette.triggerMethod.call(view, "before:show");
    }

    if (isDifferentView || isViewClosed) {
      this.open(view);
    }

    this.currentView = view;

    Marionette.triggerMethod.call(this, "show", view);

    if (_.isFunction(view.triggerMethod)) {
      view.triggerMethod("show");
    } else {
      Marionette.triggerMethod.call(view, "show");
    }

    return this;
  },

  ensureEl: function(){
    if (!this.$el || this.$el.length === 0){
      this.$el = this.getEl(this.el);
    }
  },

  // Override this method to change how the region finds the
  // DOM element that it manages. Return a jQuery selector object.
  getEl: function(selector){
    return Marionette.$(selector);
  },

  // Override this method to change how the new view is
  // appended to the `$el` that the region is managing
  open: function(view){
    this.$el.empty().append(view.el);
  },

  // Close the current view, if there is one. If there is no
  // current view, it does nothing and returns immediately.
  close: function(){
    var view = this.currentView;
    if (!view || view.isClosed){ return; }

    // call 'close' or 'remove', depending on which is found
    if (view.close) { view.close(); }
    else if (view.remove) { view.remove(); }

    Marionette.triggerMethod.call(this, "close", view);

    delete this.currentView;
  },

  // Attach an existing view to the region. This
  // will not call `render` or `onShow` for the new view,
  // and will not replace the current HTML for the `el`
  // of the region.
  attachView: function(view){
    this.currentView = view;
  },

  // Reset the region by closing any existing view and
  // clearing out the cached `$el`. The next time a view
  // is shown via this region, the region will re-query the
  // DOM for the region's `el`.
  reset: function(){
    this.close();
    delete this.$el;
  }
});

// Copy the `extend` function used by Backbone's classes
Marionette.Region.extend = Marionette.extend;

// Marionette.RegionManager
// ------------------------
//
// Manage one or more related `Marionette.Region` objects.
Marionette.RegionManager = (function(Marionette){

  var RegionManager = Marionette.Controller.extend({
    constructor: function(options){
      this._regions = {};
      Marionette.Controller.prototype.constructor.call(this, options);
    },

    // Add multiple regions using an object literal, where
    // each key becomes the region name, and each value is
    // the region definition.
    addRegions: function(regionDefinitions, defaults){
      var regions = {};

      _.each(regionDefinitions, function(definition, name){
        if (_.isString(definition)){
          definition = { selector: definition };
        }

        if (definition.selector){
          definition = _.defaults({}, definition, defaults);
        }

        var region = this.addRegion(name, definition);
        regions[name] = region;
      }, this);

      return regions;
    },

    // Add an individual region to the region manager,
    // and return the region instance
    addRegion: function(name, definition){
      var region;

      var isObject = _.isObject(definition);
      var isString = _.isString(definition);
      var hasSelector = !!definition.selector;

      if (isString || (isObject && hasSelector)){
        region = Marionette.Region.buildRegion(definition, Marionette.Region);
      } else if (_.isFunction(definition)){
        region = Marionette.Region.buildRegion(definition, Marionette.Region);
      } else {
        region = definition;
      }

      this._store(name, region);
      this.triggerMethod("region:add", name, region);
      return region;
    },

    // Get a region by name
    get: function(name){
      return this._regions[name];
    },

    // Remove a region by name
    removeRegion: function(name){
      var region = this._regions[name];
      this._remove(name, region);
    },

    // Close all regions in the region manager, and
    // remove them
    removeRegions: function(){
      _.each(this._regions, function(region, name){
        this._remove(name, region);
      }, this);
    },

    // Close all regions in the region manager, but
    // leave them attached
    closeRegions: function(){
      _.each(this._regions, function(region, name){
        region.close();
      }, this);
    },

    // Close all regions and shut down the region
    // manager entirely
    close: function(){
      this.removeRegions();
      Marionette.Controller.prototype.close.apply(this, arguments);
    },

    // internal method to store regions
    _store: function(name, region){
      this._regions[name] = region;
      this._setLength();
    },

    // internal method to remove a region
    _remove: function(name, region){
      region.close();
      region.stopListening();
      delete this._regions[name];
      this._setLength();
      this.triggerMethod("region:remove", name, region);
    },

    // set the number of regions current held
    _setLength: function(){
      this.length = _.size(this._regions);
    }

  });

  Marionette.actAsCollection(RegionManager.prototype, '_regions');

  return RegionManager;
})(Marionette);


// Template Cache
// --------------

// Manage templates stored in `<script>` blocks,
// caching them for faster access.
Marionette.TemplateCache = function(templateId){
  this.templateId = templateId;
};

// TemplateCache object-level methods. Manage the template
// caches from these method calls instead of creating
// your own TemplateCache instances
_.extend(Marionette.TemplateCache, {
  templateCaches: {},

  // Get the specified template by id. Either
  // retrieves the cached version, or loads it
  // from the DOM.
  get: function(templateId){
    var cachedTemplate = this.templateCaches[templateId];

    if (!cachedTemplate){
      cachedTemplate = new Marionette.TemplateCache(templateId);
      this.templateCaches[templateId] = cachedTemplate;
    }

    return cachedTemplate.load();
  },

  // Clear templates from the cache. If no arguments
  // are specified, clears all templates:
  // `clear()`
  //
  // If arguments are specified, clears each of the
  // specified templates from the cache:
  // `clear("#t1", "#t2", "...")`
  clear: function(){
    var i;
    var args = slice.call(arguments);
    var length = args.length;

    if (length > 0){
      for(i=0; i<length; i++){
        delete this.templateCaches[args[i]];
      }
    } else {
      this.templateCaches = {};
    }
  }
});

// TemplateCache instance methods, allowing each
// template cache object to manage its own state
// and know whether or not it has been loaded
_.extend(Marionette.TemplateCache.prototype, {

  // Internal method to load the template
  load: function(){
    // Guard clause to prevent loading this template more than once
    if (this.compiledTemplate){
      return this.compiledTemplate;
    }

    // Load the template and compile it
    var template = this.loadTemplate(this.templateId);
    this.compiledTemplate = this.compileTemplate(template);

    return this.compiledTemplate;
  },

  // Load a template from the DOM, by default. Override
  // this method to provide your own template retrieval
  // For asynchronous loading with AMD/RequireJS, consider
  // using a template-loader plugin as described here:
  // https://github.com/marionettejs/backbone.marionette/wiki/Using-marionette-with-requirejs
  loadTemplate: function(templateId){
    var template = Marionette.$(templateId).html();

    if (!template || template.length === 0){
      throwError("Could not find template: '" + templateId + "'", "NoTemplateError");
    }

    return template;
  },

  // Pre-compile the template before caching it. Override
  // this method if you do not need to pre-compile a template
  // (JST / RequireJS for example) or if you want to change
  // the template engine used (Handebars, etc).
  compileTemplate: function(rawTemplate){
    return _.template(rawTemplate);
  }
});

// Renderer
// --------

// Render a template with data by passing in the template
// selector and the data to render.
Marionette.Renderer = {

  // Render a template with data. The `template` parameter is
  // passed to the `TemplateCache` object to retrieve the
  // template function. Override this method to provide your own
  // custom rendering and template handling for all of Marionette.
  render: function(template, data){

    if (!template) {
      throwError("Cannot render the template since it's false, null or undefined.", "TemplateNotFoundError");
    }

    var templateFunc;
    if (typeof template === "function"){
      templateFunc = template;
    } else {
      templateFunc = Marionette.TemplateCache.get(template);
    }

    return templateFunc(data);
  }
};


// Marionette.View
// ---------------

// The core view type that other Marionette views extend from.
Marionette.View = Backbone.View.extend({

  constructor: function(options){
    _.bindAll(this, "render");

    // this exposes view options to the view initializer
    // this is a backfill since backbone removed the assignment
    // of this.options
    // at some point however this may be removed
    this.options = _.extend({}, _.result(this, 'options'), _.isFunction(options) ? options.call(this) : options);

    // parses out the @ui DSL for events
    this.events = this.normalizeUIKeys(_.result(this, 'events'));

    if (_.isObject(this.behaviors)) {
      new Marionette.Behaviors(this);
    }

    Backbone.View.prototype.constructor.apply(this, arguments);

    Marionette.MonitorDOMRefresh(this);
    this.listenTo(this, "show", this.onShowCalled);
  },

  // import the "triggerMethod" to trigger events with corresponding
  // methods if the method exists
  triggerMethod: Marionette.triggerMethod,

  // Imports the "normalizeMethods" to transform hashes of
  // events=>function references/names to a hash of events=>function references
  normalizeMethods: Marionette.normalizeMethods,

  // Get the template for this view
  // instance. You can set a `template` attribute in the view
  // definition or pass a `template: "whatever"` parameter in
  // to the constructor options.
  getTemplate: function(){
    return Marionette.getOption(this, "template");
  },

  // Mix in template helper methods. Looks for a
  // `templateHelpers` attribute, which can either be an
  // object literal, or a function that returns an object
  // literal. All methods and attributes from this object
  // are copies to the object passed in.
  mixinTemplateHelpers: function(target){
    target = target || {};
    var templateHelpers = Marionette.getOption(this, "templateHelpers");
    if (_.isFunction(templateHelpers)){
      templateHelpers = templateHelpers.call(this);
    }
    return _.extend(target, templateHelpers);
  },


  normalizeUIKeys: function(hash) {
    var ui = _.result(this, 'ui');
    return Marionette.normalizeUIKeys(hash, ui);
  },

  // Configure `triggers` to forward DOM events to view
  // events. `triggers: {"click .foo": "do:foo"}`
  configureTriggers: function(){
    if (!this.triggers) { return; }

    var triggerEvents = {};

    // Allow `triggers` to be configured as a function
    var triggers = this.normalizeUIKeys(_.result(this, "triggers"));

    // Configure the triggers, prevent default
    // action and stop propagation of DOM events
    _.each(triggers, function(value, key){

      var hasOptions = _.isObject(value);
      var eventName = hasOptions ? value.event : value;

      // build the event handler function for the DOM event
      triggerEvents[key] = function(e){

        // stop the event in its tracks
        if (e) {
          var prevent = e.preventDefault;
          var stop = e.stopPropagation;

          var shouldPrevent = hasOptions ? value.preventDefault : prevent;
          var shouldStop = hasOptions ? value.stopPropagation : stop;

          if (shouldPrevent && prevent) { prevent.apply(e); }
          if (shouldStop && stop) { stop.apply(e); }
        }

        // build the args for the event
        var args = {
          view: this,
          model: this.model,
          collection: this.collection
        };

        // trigger the event
        this.triggerMethod(eventName, args);
      };

    }, this);

    return triggerEvents;
  },

  // Overriding Backbone.View's delegateEvents to handle
  // the `triggers`, `modelEvents`, and `collectionEvents` configuration
  delegateEvents: function(events){
    this._delegateDOMEvents(events);
    Marionette.bindEntityEvents(this, this.model, Marionette.getOption(this, "modelEvents"));
    Marionette.bindEntityEvents(this, this.collection, Marionette.getOption(this, "collectionEvents"));
  },

  // internal method to delegate DOM events and triggers
  _delegateDOMEvents: function(events){
    events = events || this.events;
    if (_.isFunction(events)){ events = events.call(this); }

    var combinedEvents = {};

    // look up if this view has behavior events
    var behaviorEvents = _.result(this, 'behaviorEvents') || {};
    var triggers = this.configureTriggers();

    // behavior events will be overriden by view events and or triggers
    _.extend(combinedEvents, behaviorEvents, events, triggers);

    Backbone.View.prototype.delegateEvents.call(this, combinedEvents);
  },

  // Overriding Backbone.View's undelegateEvents to handle unbinding
  // the `triggers`, `modelEvents`, and `collectionEvents` config
  undelegateEvents: function(){
    var args = Array.prototype.slice.call(arguments);
    Backbone.View.prototype.undelegateEvents.apply(this, args);

    Marionette.unbindEntityEvents(this, this.model, Marionette.getOption(this, "modelEvents"));
    Marionette.unbindEntityEvents(this, this.collection, Marionette.getOption(this, "collectionEvents"));
  },

  // Internal method, handles the `show` event.
  onShowCalled: function(){},

  // Default `close` implementation, for removing a view from the
  // DOM and unbinding it. Regions will call this method
  // for you. You can specify an `onClose` method in your view to
  // add custom code that is called after the view is closed.
  close: function(){
    if (this.isClosed) { return; }

    var args = Array.prototype.slice.call(arguments);

    // allow the close to be stopped by returning `false`
    // from the `onBeforeClose` method
    var shouldClose = this.triggerMethod.apply(this, ["before:close"].concat(args));
    if (shouldClose === false){
      return;
    }

    // mark as closed before doing the actual close, to
    // prevent infinite loops within "close" event handlers
    // that are trying to close other views
    this.isClosed = true;
    this.triggerMethod.apply(this, ["close"].concat(args));

    // unbind UI elements
    this.unbindUIElements();

    // remove the view from the DOM
    this.remove();
  },

  // This method binds the elements specified in the "ui" hash inside the view's code with
  // the associated jQuery selectors.
  bindUIElements: function(){
    if (!this.ui) { return; }

    // store the ui hash in _uiBindings so they can be reset later
    // and so re-rendering the view will be able to find the bindings
    if (!this._uiBindings){
      this._uiBindings = this.ui;
    }

    // get the bindings result, as a function or otherwise
    var bindings = _.result(this, "_uiBindings");

    // empty the ui so we don't have anything to start with
    this.ui = {};

    // bind each of the selectors
    _.each(_.keys(bindings), function(key) {
      var selector = bindings[key];
      this.ui[key] = this.$(selector);
    }, this);
  },

  // This method unbinds the elements specified in the "ui" hash
  unbindUIElements: function(){
    if (!this.ui || !this._uiBindings){ return; }

    // delete all of the existing ui bindings
    _.each(this.ui, function($el, name){
      delete this.ui[name];
    }, this);

    // reset the ui element to the original bindings configuration
    this.ui = this._uiBindings;
    delete this._uiBindings;
  }
});

// Item View
// ---------

// A single item view implementation that contains code for rendering
// with underscore.js templates, serializing the view's model or collection,
// and calling several methods on extended views, such as `onRender`.
Marionette.ItemView = Marionette.View.extend({

  // Setting up the inheritance chain which allows changes to
  // Marionette.View.prototype.constructor which allows overriding
  constructor: function(){
    Marionette.View.prototype.constructor.apply(this, arguments);
  },

  // Serialize the model or collection for the view. If a model is
  // found, `.toJSON()` is called. If a collection is found, `.toJSON()`
  // is also called, but is used to populate an `items` array in the
  // resulting data. If both are found, defaults to the model.
  // You can override the `serializeData` method in your own view
  // definition, to provide custom serialization for your view's data.
  serializeData: function(){
    var data = {};

    if (this.model) {
      data = this.model.toJSON();
    }
    else if (this.collection) {
      data = { items: this.collection.toJSON() };
    }

    return data;
  },

  // Render the view, defaulting to underscore.js templates.
  // You can override this in your view definition to provide
  // a very specific rendering for your view. In general, though,
  // you should override the `Marionette.Renderer` object to
  // change how Marionette renders views.
  render: function(){
    this.isClosed = false;

    this.triggerMethod("before:render", this);
    this.triggerMethod("item:before:render", this);

    var data = this.serializeData();
    data = this.mixinTemplateHelpers(data);

    var template = this.getTemplate();
    var html = Marionette.Renderer.render(template, data);

    this.$el.html(html);
    this.bindUIElements();

    this.triggerMethod("render", this);
    this.triggerMethod("item:rendered", this);

    return this;
  },

  // Override the default close event to add a few
  // more events that are triggered.
  close: function(){
    if (this.isClosed){ return; }

    this.triggerMethod('item:before:close');

    Marionette.View.prototype.close.apply(this, arguments);

    this.triggerMethod('item:closed');
  }
});

// Collection View
// ---------------

// A view that iterates over a Backbone.Collection
// and renders an individual ItemView for each model.
Marionette.CollectionView = Marionette.View.extend({
  // used as the prefix for item view events
  // that are forwarded through the collectionview
  itemViewEventPrefix: "itemview",

  // constructor
  constructor: function(options){
    this._initChildViewStorage();

    Marionette.View.prototype.constructor.apply(this, arguments);

    this._initialEvents();
    this.initRenderBuffer();
  },

  // Instead of inserting elements one by one into the page,
  // it's much more performant to insert elements into a document
  // fragment and then insert that document fragment into the page
  initRenderBuffer: function() {
    this.elBuffer = document.createDocumentFragment();
    this._bufferedChildren = [];
  },

  startBuffering: function() {
    this.initRenderBuffer();
    this.isBuffering = true;
  },

  endBuffering: function() {
    this.isBuffering = false;
    this.appendBuffer(this, this.elBuffer);
    this._triggerShowBufferedChildren();
    this.initRenderBuffer();
  },

  _triggerShowBufferedChildren: function () {
    if (this._isShown) {
      _.each(this._bufferedChildren, function (child) {
        if (_.isFunction(child.triggerMethod)) {
          child.triggerMethod('show');
        } else {
          Marionette.triggerMethod.call(child, 'show');
        }
      });
      this._bufferedChildren = [];
    }
  },

  // Configured the initial events that the collection view
  // binds to.
  _initialEvents: function(){
    if (this.collection){
      this.listenTo(this.collection, "add", this.addChildView);
      this.listenTo(this.collection, "remove", this.removeItemView);
      this.listenTo(this.collection, "reset", this.render);
    }
  },

  // Handle a child item added to the collection
  addChildView: function(item, collection, options){
    this.closeEmptyView();
    var ItemView = this.getItemView(item);
    var index = this.collection.indexOf(item);
    this.addItemView(item, ItemView, index);
  },

  // Override from `Marionette.View` to guarantee the `onShow` method
  // of child views is called.
  onShowCalled: function(){
    this.children.each(function(child){
      if (_.isFunction(child.triggerMethod)) {
        child.triggerMethod('show');
      } else {
        Marionette.triggerMethod.call(child, 'show');
      }
    });
  },

  // Internal method to trigger the before render callbacks
  // and events
  triggerBeforeRender: function(){
    this.triggerMethod("before:render", this);
    this.triggerMethod("collection:before:render", this);
  },

  // Internal method to trigger the rendered callbacks and
  // events
  triggerRendered: function(){
    this.triggerMethod("render", this);
    this.triggerMethod("collection:rendered", this);
  },

  // Render the collection of items. Override this method to
  // provide your own implementation of a render function for
  // the collection view.
  render: function(){
    this.isClosed = false;
    this.triggerBeforeRender();
    this._renderChildren();
    this.triggerRendered();
    return this;
  },

  // Internal method. Separated so that CompositeView can have
  // more control over events being triggered, around the rendering
  // process
  _renderChildren: function(){
    this.startBuffering();

    this.closeEmptyView();
    this.closeChildren();

    if (!this.isEmpty(this.collection)) {
      this.showCollection();
    } else {
      this.showEmptyView();
    }

    this.endBuffering();
  },

  // Internal method to loop through each item in the
  // collection view and show it
  showCollection: function(){
    var ItemView;
    this.collection.each(function(item, index){
      ItemView = this.getItemView(item);
      this.addItemView(item, ItemView, index);
    }, this);
  },

  // Internal method to show an empty view in place of
  // a collection of item views, when the collection is
  // empty
  showEmptyView: function(){
    var EmptyView = this.getEmptyView();

    if (EmptyView && !this._showingEmptyView){
      this._showingEmptyView = true;
      var model = new Backbone.Model();
      this.addItemView(model, EmptyView, 0);
    }
  },

  // Internal method to close an existing emptyView instance
  // if one exists. Called when a collection view has been
  // rendered empty, and then an item is added to the collection.
  closeEmptyView: function(){
    if (this._showingEmptyView){
      this.closeChildren();
      delete this._showingEmptyView;
    }
  },

  // Retrieve the empty view type
  getEmptyView: function(){
    return Marionette.getOption(this, "emptyView");
  },

  // Retrieve the itemView type, either from `this.options.itemView`
  // or from the `itemView` in the object definition. The "options"
  // takes precedence.
  getItemView: function(item){
    var itemView = Marionette.getOption(this, "itemView");

    if (!itemView){
      throwError("An `itemView` must be specified", "NoItemViewError");
    }

    return itemView;
  },

  // Render the child item's view and add it to the
  // HTML for the collection view.
  addItemView: function(item, ItemView, index){
    // get the itemViewOptions if any were specified
    var itemViewOptions = Marionette.getOption(this, "itemViewOptions");
    if (_.isFunction(itemViewOptions)){
      itemViewOptions = itemViewOptions.call(this, item, index);
    }

    // build the view
    var view = this.buildItemView(item, ItemView, itemViewOptions);

    // set up the child view event forwarding
    this.addChildViewEventForwarding(view);

    // this view is about to be added
    this.triggerMethod("before:item:added", view);

    // Store the child view itself so we can properly
    // remove and/or close it later
    this.children.add(view);

    // Render it and show it
    this.renderItemView(view, index);

    // call the "show" method if the collection view
    // has already been shown
    if (this._isShown && !this.isBuffering){
      if (_.isFunction(view.triggerMethod)) {
        view.triggerMethod('show');
      } else {
        Marionette.triggerMethod.call(view, 'show');
      }
    }

    // this view was added
    this.triggerMethod("after:item:added", view);

    return view;
  },

  // Set up the child view event forwarding. Uses an "itemview:"
  // prefix in front of all forwarded events.
  addChildViewEventForwarding: function(view){
    var prefix = Marionette.getOption(this, "itemViewEventPrefix");

    // Forward all child item view events through the parent,
    // prepending "itemview:" to the event name
    this.listenTo(view, "all", function(){
      var args = slice.call(arguments);
      var rootEvent = args[0];
      var itemEvents = this.normalizeMethods(this.getItemEvents());

      args[0] = prefix + ":" + rootEvent;
      args.splice(1, 0, view);

      // call collectionView itemEvent if defined
      if (typeof itemEvents !== "undefined" && _.isFunction(itemEvents[rootEvent])) {
        itemEvents[rootEvent].apply(this, args);
      }

      Marionette.triggerMethod.apply(this, args);
    }, this);
  },

  // returns the value of itemEvents depending on if a function
  getItemEvents: function() {
    if (_.isFunction(this.itemEvents)) {
      return this.itemEvents.call(this);
    }

    return this.itemEvents;
  },

  // render the item view
  renderItemView: function(view, index) {
    view.render();
    this.appendHtml(this, view, index);
  },

  // Build an `itemView` for every model in the collection.
  buildItemView: function(item, ItemViewType, itemViewOptions){
    var options = _.extend({model: item}, itemViewOptions);
    return new ItemViewType(options);
  },

  // get the child view by item it holds, and remove it
  removeItemView: function(item){
    var view = this.children.findByModel(item);
    this.removeChildView(view);
    this.checkEmpty();
  },

  // Remove the child view and close it
  removeChildView: function(view){

    // shut down the child view properly,
    // including events that the collection has from it
    if (view){
      // call 'close' or 'remove', depending on which is found
      if (view.close) { view.close(); }
      else if (view.remove) { view.remove(); }

      this.stopListening(view);
      this.children.remove(view);
    }

    this.triggerMethod("item:removed", view);
  },

  // helper to check if the collection is empty
  isEmpty: function(collection){
    // check if we're empty now
    return !this.collection || this.collection.length === 0;
  },

  // If empty, show the empty view
  checkEmpty: function (){
    if (this.isEmpty(this.collection)){
      this.showEmptyView();
    }
  },

  // You might need to override this if you've overridden appendHtml
  appendBuffer: function(collectionView, buffer) {
    collectionView.$el.append(buffer);
  },

  // Append the HTML to the collection's `el`.
  // Override this method to do something other
  // than `.append`.
  appendHtml: function(collectionView, itemView, index){
    if (collectionView.isBuffering) {
      // buffering happens on reset events and initial renders
      // in order to reduce the number of inserts into the
      // document, which are expensive.
      collectionView.elBuffer.appendChild(itemView.el);
      collectionView._bufferedChildren.push(itemView);
    }
    else {
      // If we've already rendered the main collection, just
      // append the new items directly into the element.
      collectionView.$el.append(itemView.el);
    }
  },

  // Internal method to set up the `children` object for
  // storing all of the child views
  _initChildViewStorage: function(){
    this.children = new Backbone.ChildViewContainer();
  },

  // Handle cleanup and other closing needs for
  // the collection of views.
  close: function(){
    if (this.isClosed){ return; }

    this.triggerMethod("collection:before:close");
    this.closeChildren();
    this.triggerMethod("collection:closed");

    Marionette.View.prototype.close.apply(this, arguments);
  },

  // Close the child views that this collection view
  // is holding on to, if any
  closeChildren: function(){
    this.children.each(function(child){
      this.removeChildView(child);
    }, this);
    this.checkEmpty();
  }
});

// Composite View
// --------------

// Used for rendering a branch-leaf, hierarchical structure.
// Extends directly from CollectionView and also renders an
// an item view as `modelView`, for the top leaf
Marionette.CompositeView = Marionette.CollectionView.extend({

  // Setting up the inheritance chain which allows changes to
  // Marionette.CollectionView.prototype.constructor which allows overriding
  constructor: function(){
    Marionette.CollectionView.prototype.constructor.apply(this, arguments);
  },

  // Configured the initial events that the composite view
  // binds to. Override this method to prevent the initial
  // events, or to add your own initial events.
  _initialEvents: function(){

    // Bind only after composite view is rendered to avoid adding child views
    // to nonexistent itemViewContainer
    this.once('render', function () {
      if (this.collection){
        this.listenTo(this.collection, "add", this.addChildView);
        this.listenTo(this.collection, "remove", this.removeItemView);
        this.listenTo(this.collection, "reset", this._renderChildren);
      }
    });

  },

  // Retrieve the `itemView` to be used when rendering each of
  // the items in the collection. The default is to return
  // `this.itemView` or Marionette.CompositeView if no `itemView`
  // has been defined
  getItemView: function(item){
    var itemView = Marionette.getOption(this, "itemView") || this.constructor;

    if (!itemView){
      throwError("An `itemView` must be specified", "NoItemViewError");
    }

    return itemView;
  },

  // Serialize the collection for the view.
  // You can override the `serializeData` method in your own view
  // definition, to provide custom serialization for your view's data.
  serializeData: function(){
    var data = {};

    if (this.model){
      data = this.model.toJSON();
    }

    return data;
  },

  // Renders the model once, and the collection once. Calling
  // this again will tell the model's view to re-render itself
  // but the collection will not re-render.
  render: function(){
    this.isRendered = true;
    this.isClosed = false;
    this.resetItemViewContainer();

    this.triggerBeforeRender();
    var html = this.renderModel();
    this.$el.html(html);
    // the ui bindings is done here and not at the end of render since they
    // will not be available until after the model is rendered, but should be
    // available before the collection is rendered.
    this.bindUIElements();
    this.triggerMethod("composite:model:rendered");

    this._renderChildren();

    this.triggerMethod("composite:rendered");
    this.triggerRendered();
    return this;
  },

  _renderChildren: function(){
    if (this.isRendered){
      this.triggerMethod("composite:collection:before:render");
      Marionette.CollectionView.prototype._renderChildren.call(this);
      this.triggerMethod("composite:collection:rendered");
    }
  },

  // Render an individual model, if we have one, as
  // part of a composite view (branch / leaf). For example:
  // a treeview.
  renderModel: function(){
    var data = {};
    data = this.serializeData();
    data = this.mixinTemplateHelpers(data);

    var template = this.getTemplate();
    return Marionette.Renderer.render(template, data);
  },


  // You might need to override this if you've overridden appendHtml
  appendBuffer: function(compositeView, buffer) {
    var $container = this.getItemViewContainer(compositeView);
    $container.append(buffer);
  },

  // Appends the `el` of itemView instances to the specified
  // `itemViewContainer` (a jQuery selector). Override this method to
  // provide custom logic of how the child item view instances have their
  // HTML appended to the composite view instance.
  appendHtml: function(compositeView, itemView, index){
    if (compositeView.isBuffering) {
      compositeView.elBuffer.appendChild(itemView.el);
      compositeView._bufferedChildren.push(itemView);
    }
    else {
      // If we've already rendered the main collection, just
      // append the new items directly into the element.
      var $container = this.getItemViewContainer(compositeView);
      $container.append(itemView.el);
    }
  },

  // Internal method to ensure an `$itemViewContainer` exists, for the
  // `appendHtml` method to use.
  getItemViewContainer: function(containerView){
    if ("$itemViewContainer" in containerView){
      return containerView.$itemViewContainer;
    }

    var container;
    var itemViewContainer = Marionette.getOption(containerView, "itemViewContainer");
    if (itemViewContainer){

      var selector = _.isFunction(itemViewContainer) ? itemViewContainer.call(containerView) : itemViewContainer;

      if (selector.charAt(0) === "@" && containerView.ui) {
        container = containerView.ui[selector.substr(4)];
      } else {
        container = containerView.$(selector);
      }

      if (container.length <= 0) {
        throwError("The specified `itemViewContainer` was not found: " + containerView.itemViewContainer, "ItemViewContainerMissingError");
      }

    } else {
      container = containerView.$el;
    }

    containerView.$itemViewContainer = container;
    return container;
  },

  // Internal method to reset the `$itemViewContainer` on render
  resetItemViewContainer: function(){
    if (this.$itemViewContainer){
      delete this.$itemViewContainer;
    }
  }
});

// Layout
// ------

// Used for managing application layouts, nested layouts and
// multiple regions within an application or sub-application.
//
// A specialized view type that renders an area of HTML and then
// attaches `Region` instances to the specified `regions`.
// Used for composite view management and sub-application areas.
Marionette.Layout = Marionette.ItemView.extend({
  regionType: Marionette.Region,

  // Ensure the regions are available when the `initialize` method
  // is called.
  constructor: function (options) {
    options = options || {};

    this._firstRender = true;
    this._initializeRegions(options);

    Marionette.ItemView.prototype.constructor.call(this, options);
  },

  // Layout's render will use the existing region objects the
  // first time it is called. Subsequent calls will close the
  // views that the regions are showing and then reset the `el`
  // for the regions to the newly rendered DOM elements.
  render: function(){

    if (this.isClosed){
      // a previously closed layout means we need to
      // completely re-initialize the regions
      this._initializeRegions();
    }
    if (this._firstRender) {
      // if this is the first render, don't do anything to
      // reset the regions
      this._firstRender = false;
    } else if (!this.isClosed){
      // If this is not the first render call, then we need to
      // re-initializing the `el` for each region
      this._reInitializeRegions();
    }

    return Marionette.ItemView.prototype.render.apply(this, arguments);
  },

  // Handle closing regions, and then close the view itself.
  close: function () {
    if (this.isClosed){ return; }
    this.regionManager.close();
    Marionette.ItemView.prototype.close.apply(this, arguments);
  },

  // Add a single region, by name, to the layout
  addRegion: function(name, definition){
    var regions = {};
    regions[name] = definition;
    return this._buildRegions(regions)[name];
  },

  // Add multiple regions as a {name: definition, name2: def2} object literal
  addRegions: function(regions){
    this.regions = _.extend({}, this.regions, regions);
    return this._buildRegions(regions);
  },

  // Remove a single region from the Layout, by name
  removeRegion: function(name){
    delete this.regions[name];
    return this.regionManager.removeRegion(name);
  },

  // Provides alternative access to regions
  // Accepts the region name
  // getRegion('main')
  getRegion: function(region) {
    return this.regionManager.get(region);
  },

  // internal method to build regions
  _buildRegions: function(regions){
    var that = this;

    var defaults = {
      regionType: Marionette.getOption(this, "regionType"),
      parentEl: function(){ return that.$el; }
    };

    return this.regionManager.addRegions(regions, defaults);
  },

  // Internal method to initialize the regions that have been defined in a
  // `regions` attribute on this layout.
  _initializeRegions: function (options) {
    var regions;
    this._initRegionManager();

    if (_.isFunction(this.regions)) {
      regions = this.regions(options);
    } else {
      regions = this.regions || {};
    }

    this.addRegions(regions);
  },

  // Internal method to re-initialize all of the regions by updating the `el` that
  // they point to
  _reInitializeRegions: function(){
    this.regionManager.closeRegions();
    this.regionManager.each(function(region){
      region.reset();
    });
  },

  // Internal method to initialize the region manager
  // and all regions in it
  _initRegionManager: function(){
    this.regionManager = new Marionette.RegionManager();

    this.listenTo(this.regionManager, "region:add", function(name, region){
      this[name] = region;
      this.trigger("region:add", name, region);
    });

    this.listenTo(this.regionManager, "region:remove", function(name, region){
      delete this[name];
      this.trigger("region:remove", name, region);
    });
  }
});


// Behavior
// -----------

// A Behavior is an isolated set of DOM /
// user interactions that can be mixed into any View.
// Behaviors allow you to blackbox View specific interactions
// into portable logical chunks, keeping your views simple and your code DRY.

Marionette.Behavior = (function(_, Backbone){
  function Behavior(options, view){
    // Setup reference to the view.
    // this comes in handle when a behavior
    // wants to directly talk up the chain
    // to the view.
    this.view = view;
    this.defaults = _.result(this, "defaults") || {};
    this.options  = _.extend({}, this.defaults, options);

    // proxy behavior $ method to the view
    // this is useful for doing jquery DOM lookups
    // scoped to behaviors view.
    this.$ = function() {
      return this.view.$.apply(this.view, arguments);
    };

    // Call the initialize method passing
    // the arguments from the instance constructor
    this.initialize.apply(this, arguments);
  }

  _.extend(Behavior.prototype, Backbone.Events, {
    initialize: function(){},

    // stopListening to behavior `onListen` events.
    close: function() {
      this.stopListening();
    },

    // Setup class level proxy for triggerMethod.
    triggerMethod: Marionette.triggerMethod
  });

  // Borrow Backbones extend implementation
  // this allows us to setup a proper
  // inheritence pattern that follow in suite
  // with the rest of Marionette views.
  Behavior.extend = Marionette.extend;

  return Behavior;
})(_, Backbone);

// Marionette.Behaviors
// --------

// Behaviors is a utility class that takes care of
// glueing your behavior instances to their given View.
// The most important part of this class is that you
// **MUST** override the class level behaviorsLookup
// method for things to work properly.

Marionette.Behaviors = (function(Marionette, _) {

  function Behaviors(view) {
    // Behaviors defined on a view can be a flat object literal
    // or it can be a function that returns an object.
    this.behaviors = Behaviors.parseBehaviors(view, _.result(view, 'behaviors'));

    // Wraps several of the view's methods
    // calling the methods first on each behavior
    // and then eventually calling the method on the view.
    Behaviors.wrap(view, this.behaviors, [
      'bindUIElements', 'unbindUIElements',
      'delegateEvents', 'undelegateEvents',
      'behaviorEvents', 'triggerMethod',
      'setElement', 'close'
    ]);
  }

  var methods = {
    setElement: function(setElement, behaviors) {
      setElement.apply(this, _.tail(arguments, 2));

      // proxy behavior $el to the view's $el.
      // This is needed because a view's $el proxy
      // is not set until after setElement is called.
      _.each(behaviors, function(b) {
        b.$el = this.$el;
      }, this);
    },

    close: function(close, behaviors) {
      var args = _.tail(arguments, 2);
      close.apply(this, args);

      // Call close on each behavior after
      // closing down the view.
      // This unbinds event listeners
      // that behaviors have registerd for.
      _.invoke(behaviors, 'close', args);
    },

    bindUIElements: function(bindUIElements, behaviors) {
      bindUIElements.apply(this);
      _.invoke(behaviors, bindUIElements);
    },

    unbindUIElements: function(unbindUIElements, behaviors) {
      unbindUIElements.apply(this);
      _.invoke(behaviors, unbindUIElements);
    },

    triggerMethod: function(triggerMethod, behaviors) {
      var args = _.tail(arguments, 2);
      triggerMethod.apply(this, args);

      _.each(behaviors, function(b) {
        triggerMethod.apply(b, args);
      });
    },

    delegateEvents: function(delegateEvents, behaviors) {
      var args = _.tail(arguments, 2);
      delegateEvents.apply(this, args);

      _.each(behaviors, function(b){
        Marionette.bindEntityEvents(b, this.model, Marionette.getOption(b, "modelEvents"));
        Marionette.bindEntityEvents(b, this.collection, Marionette.getOption(b, "collectionEvents"));
      }, this);
    },

    undelegateEvents: function(undelegateEvents, behaviors) {
      var args = _.tail(arguments, 2);
      undelegateEvents.apply(this, args);

      _.each(behaviors, function(b) {
        Marionette.unbindEntityEvents(b, this.model, Marionette.getOption(b, "modelEvents"));
        Marionette.unbindEntityEvents(b, this.collection, Marionette.getOption(b, "collectionEvents"));
      }, this);
    },

    behaviorEvents: function(behaviorEvents, behaviors) {
      var _behaviorsEvents = {};
      var viewUI = _.result(this, 'ui');

      _.each(behaviors, function(b, i) {
        var _events = {};
        var behaviorEvents = _.clone(_.result(b, 'events')) || {};
        var behaviorUI = _.result(b, 'ui');

        // Construct an internal UI hash first using
        // the views UI hash and then the behaviors UI hash.
        // This allows the user to use UI hash elements
        // defined in the parent view as well as those
        // defined in the given behavior.
        var ui = _.extend({}, viewUI, behaviorUI);

        // Normalize behavior events hash to allow
        // a user to use the @ui. syntax.
        behaviorEvents = Marionette.normalizeUIKeys(behaviorEvents, ui);

        _.each(_.keys(behaviorEvents), function(key) {
          // append white-space at the end of each key to prevent behavior key collisions
          // this is relying on the fact backbone events considers "click .foo" the same  "click .foo "
          // starts with an array of two so the first behavior has one space

          // +2 is uses becauce new Array(1) or 0 is "" and not " "
          var whitespace = (new Array(i+2)).join(" ");
          var eventKey   = key + whitespace;
          var handler    = _.isFunction(behaviorEvents[key]) ? behaviorEvents[key] : b[behaviorEvents[key]];

          _events[eventKey] = _.bind(handler, b);
        });

        _behaviorsEvents = _.extend(_behaviorsEvents, _events);
      });

      return _behaviorsEvents;
    }
  };

  _.extend(Behaviors, {

    // placeholder method to be extended by the user
    // should define the object that stores the behaviors
    // i.e.
    //
    // Marionette.Behaviors.behaviorsLookup: function() {
    //   return App.Behaviors
    // }
    behaviorsLookup: function() {
      throw new Error("You must define where your behaviors are stored. See https://github.com/marionettejs/backbone.marionette/blob/master/docs/marionette.behaviors.md#behaviorslookup");
    },

    // Takes care of getting the behavior class
    // given options and a key.
    // If a user passes in options.behaviorClass
    // default to using that. Otherwise delegate
    // the lookup to the users behaviorsLookup implementation.
    getBehaviorClass: function(options, key) {
      if (options.behaviorClass) {
        return options.behaviorClass;
      }

      // Get behavior class can be either a flat object or a method
      return _.isFunction(Behaviors.behaviorsLookup) ? Behaviors.behaviorsLookup.apply(this, arguments)[key] : Behaviors.behaviorsLookup[key];
    },

    // Maps over a view's behaviors. Performing
    // a lookup on each behavior and the instantiating
    // said behavior passing its options and view.
    parseBehaviors: function(view, behaviors){
      return _.map(behaviors, function(options, key){
        var BehaviorClass = Behaviors.getBehaviorClass(options, key);
        return new BehaviorClass(options, view);
      });
    },

    // wrap view internal methods so that they delegate to behaviors.
    // For example, onClose should trigger close on all of the behaviors and then close itself.
    // i.e.
    //
    // view.delegateEvents = _.partial(methods.delegateEvents, view.delegateEvents, behaviors);
    wrap: function(view, behaviors, methodNames) {
      _.each(methodNames, function(methodName) {
        view[methodName] = _.partial(methods[methodName], view[methodName], behaviors);
      });
    }
  });

  return Behaviors;

})(Marionette, _);


// AppRouter
// ---------

// Reduce the boilerplate code of handling route events
// and then calling a single method on another object.
// Have your routers configured to call the method on
// your object, directly.
//
// Configure an AppRouter with `appRoutes`.
//
// App routers can only take one `controller` object.
// It is recommended that you divide your controller
// objects in to smaller pieces of related functionality
// and have multiple routers / controllers, instead of
// just one giant router and controller.
//
// You can also add standard routes to an AppRouter.

Marionette.AppRouter = Backbone.Router.extend({

  constructor: function(options){
    Backbone.Router.prototype.constructor.apply(this, arguments);

    this.options = options || {};

    var appRoutes = Marionette.getOption(this, "appRoutes");
    var controller = this._getController();
    this.processAppRoutes(controller, appRoutes);
    this.on("route", this._processOnRoute, this);
  },

  // Similar to route method on a Backbone Router but
  // method is called on the controller
  appRoute: function(route, methodName) {
    var controller = this._getController();
    this._addAppRoute(controller, route, methodName);
  },

  // process the route event and trigger the onRoute
  // method call, if it exists
  _processOnRoute: function(routeName, routeArgs){
    // find the path that matched
    var routePath = _.invert(this.appRoutes)[routeName];

    // make sure an onRoute is there, and call it
    if (_.isFunction(this.onRoute)){
      this.onRoute(routeName, routePath, routeArgs);
    }
  },

  // Internal method to process the `appRoutes` for the
  // router, and turn them in to routes that trigger the
  // specified method on the specified `controller`.
  processAppRoutes: function(controller, appRoutes) {
    if (!appRoutes){ return; }

    var routeNames = _.keys(appRoutes).reverse(); // Backbone requires reverted order of routes

    _.each(routeNames, function(route) {
      this._addAppRoute(controller, route, appRoutes[route]);
    }, this);
  },

  _getController: function(){
    return Marionette.getOption(this, "controller");
  },

  _addAppRoute: function(controller, route, methodName){
    var method = controller[methodName];

    if (!method) {
      throwError("Method '" + methodName + "' was not found on the controller");
    }

    this.route(route, methodName, _.bind(method, controller));
  }
});

// Application
// -----------

// Contain and manage the composite application as a whole.
// Stores and starts up `Region` objects, includes an
// event aggregator as `app.vent`
Marionette.Application = function(options){
  this._initRegionManager();
  this._initCallbacks = new Marionette.Callbacks();
  this.vent = new Backbone.Wreqr.EventAggregator();
  this.commands = new Backbone.Wreqr.Commands();
  this.reqres = new Backbone.Wreqr.RequestResponse();
  this.submodules = {};

  _.extend(this, options);

  this.triggerMethod = Marionette.triggerMethod;
};

_.extend(Marionette.Application.prototype, Backbone.Events, {
  // Command execution, facilitated by Backbone.Wreqr.Commands
  execute: function(){
    this.commands.execute.apply(this.commands, arguments);
  },

  // Request/response, facilitated by Backbone.Wreqr.RequestResponse
  request: function(){
    return this.reqres.request.apply(this.reqres, arguments);
  },

  // Add an initializer that is either run at when the `start`
  // method is called, or run immediately if added after `start`
  // has already been called.
  addInitializer: function(initializer){
    this._initCallbacks.add(initializer);
  },

  // kick off all of the application's processes.
  // initializes all of the regions that have been added
  // to the app, and runs all of the initializer functions
  start: function(options){
    this.triggerMethod("initialize:before", options);
    this._initCallbacks.run(options, this);
    this.triggerMethod("initialize:after", options);

    this.triggerMethod("start", options);
  },

  // Add regions to your app.
  // Accepts a hash of named strings or Region objects
  // addRegions({something: "#someRegion"})
  // addRegions({something: Region.extend({el: "#someRegion"}) });
  addRegions: function(regions){
    return this._regionManager.addRegions(regions);
  },

  // Close all regions in the app, without removing them
  closeRegions: function(){
    this._regionManager.closeRegions();
  },

  // Removes a region from your app, by name
  // Accepts the regions name
  // removeRegion('myRegion')
  removeRegion: function(region) {
    this._regionManager.removeRegion(region);
  },

  // Provides alternative access to regions
  // Accepts the region name
  // getRegion('main')
  getRegion: function(region) {
    return this._regionManager.get(region);
  },

  // Create a module, attached to the application
  module: function(moduleNames, moduleDefinition){

    // Overwrite the module class if the user specifies one
    var ModuleClass = Marionette.Module.getClass(moduleDefinition);

    // slice the args, and add this application object as the
    // first argument of the array
    var args = slice.call(arguments);
    args.unshift(this);

    // see the Marionette.Module object for more information
    return ModuleClass.create.apply(ModuleClass, args);
  },

  // Internal method to set up the region manager
  _initRegionManager: function(){
    this._regionManager = new Marionette.RegionManager();

    this.listenTo(this._regionManager, "region:add", function(name, region){
      this[name] = region;
    });

    this.listenTo(this._regionManager, "region:remove", function(name, region){
      delete this[name];
    });
  }
});

// Copy the `extend` function used by Backbone's classes
Marionette.Application.extend = Marionette.extend;

// Module
// ------

// A simple module system, used to create privacy and encapsulation in
// Marionette applications
Marionette.Module = function(moduleName, app, options){
  this.moduleName = moduleName;
  this.options = _.extend({}, this.options, options);
  // Allow for a user to overide the initialize
  // for a given module instance.
  this.initialize = options.initialize || this.initialize;

  // Set up an internal store for sub-modules.
  this.submodules = {};

  this._setupInitializersAndFinalizers();

  // Set an internal reference to the app
  // within a module.
  this.app = app;

  // By default modules start with their parents.
  this.startWithParent = true;

  // Setup a proxy to the trigger method implementation.
  this.triggerMethod = Marionette.triggerMethod;

  if (_.isFunction(this.initialize)){
    this.initialize(this.options, moduleName, app);
  }
};

Marionette.Module.extend = Marionette.extend;

// Extend the Module prototype with events / listenTo, so that the module
// can be used as an event aggregator or pub/sub.
_.extend(Marionette.Module.prototype, Backbone.Events, {

  // Initialize is an empty function by default. Override it with your own
  // initialization logic when extending Marionette.Module.
  initialize: function(){},

  // Initializer for a specific module. Initializers are run when the
  // module's `start` method is called.
  addInitializer: function(callback){
    this._initializerCallbacks.add(callback);
  },

  // Finalizers are run when a module is stopped. They are used to teardown
  // and finalize any variables, references, events and other code that the
  // module had set up.
  addFinalizer: function(callback){
    this._finalizerCallbacks.add(callback);
  },

  // Start the module, and run all of its initializers
  start: function(options){
    // Prevent re-starting a module that is already started
    if (this._isInitialized){ return; }

    // start the sub-modules (depth-first hierarchy)
    _.each(this.submodules, function(mod){
      // check to see if we should start the sub-module with this parent
      if (mod.startWithParent){
        mod.start(options);
      }
    });

    // run the callbacks to "start" the current module
    this.triggerMethod("before:start", options);

    this._initializerCallbacks.run(options, this);
    this._isInitialized = true;

    this.triggerMethod("start", options);
  },

  // Stop this module by running its finalizers and then stop all of
  // the sub-modules for this module
  stop: function(){
    // if we are not initialized, don't bother finalizing
    if (!this._isInitialized){ return; }
    this._isInitialized = false;

    Marionette.triggerMethod.call(this, "before:stop");

    // stop the sub-modules; depth-first, to make sure the
    // sub-modules are stopped / finalized before parents
    _.each(this.submodules, function(mod){ mod.stop(); });

    // run the finalizers
    this._finalizerCallbacks.run(undefined,this);

    // reset the initializers and finalizers
    this._initializerCallbacks.reset();
    this._finalizerCallbacks.reset();

    Marionette.triggerMethod.call(this, "stop");
  },

  // Configure the module with a definition function and any custom args
  // that are to be passed in to the definition function
  addDefinition: function(moduleDefinition, customArgs){
    this._runModuleDefinition(moduleDefinition, customArgs);
  },

  // Internal method: run the module definition function with the correct
  // arguments
  _runModuleDefinition: function(definition, customArgs){
    // If there is no definition short circut the method.
    if (!definition){ return; }

    // build the correct list of arguments for the module definition
    var args = _.flatten([
      this,
      this.app,
      Backbone,
      Marionette,
      Marionette.$, _,
      customArgs
    ]);

    definition.apply(this, args);
  },

  // Internal method: set up new copies of initializers and finalizers.
  // Calling this method will wipe out all existing initializers and
  // finalizers.
  _setupInitializersAndFinalizers: function(){
    this._initializerCallbacks = new Marionette.Callbacks();
    this._finalizerCallbacks = new Marionette.Callbacks();
  }
});

// Type methods to create modules
_.extend(Marionette.Module, {

  // Create a module, hanging off the app parameter as the parent object.
  create: function(app, moduleNames, moduleDefinition){
    var module = app;

    // get the custom args passed in after the module definition and
    // get rid of the module name and definition function
    var customArgs = slice.call(arguments);
    customArgs.splice(0, 3);

    // Split the module names and get the number of submodules.
    // i.e. an example module name of `Doge.Wow.Amaze` would
    // then have the potential for 3 module definitions.
    moduleNames = moduleNames.split(".");
    var length = moduleNames.length;

    // store the module definition for the last module in the chain
    var moduleDefinitions = [];
    moduleDefinitions[length-1] = moduleDefinition;

    // Loop through all the parts of the module definition
    _.each(moduleNames, function(moduleName, i){
      var parentModule = module;
      module = this._getModule(parentModule, moduleName, app, moduleDefinition);
      this._addModuleDefinition(parentModule, module, moduleDefinitions[i], customArgs);
    }, this);

    // Return the last module in the definition chain
    return module;
  },

  _getModule: function(parentModule, moduleName, app, def, args){
    var options = _.extend({}, def);
    var ModuleClass = this.getClass(def);

    // Get an existing module of this name if we have one
    var module = parentModule[moduleName];

    if (!module){
      // Create a new module if we don't have one
      module = new ModuleClass(moduleName, app, options);
      parentModule[moduleName] = module;
      // store the module on the parent
      parentModule.submodules[moduleName] = module;
    }

    return module;
  },

  // ## Module Classes
  //
  // Module classes can be used as an alternative to the define pattern.
  // The extend function of a Module is identical to the extend functions
  // on other Backbone and Marionette classes.
  // This allows module lifecyle events like `onStart` and `onStop` to be called directly.
  getClass: function(moduleDefinition) {
    var ModuleClass = Marionette.Module;

    if (!moduleDefinition) {
      return ModuleClass;
    }

    // If all of the module's functionality is defined inside its class,
    // then the class can be passed in directly. `MyApp.module("Foo", FooModule)`.
    if (moduleDefinition.prototype instanceof ModuleClass) {
      return moduleDefinition;
    }

    return moduleDefinition.moduleClass || ModuleClass;
  },

  // Add the module definition and add a startWithParent initializer function.
  // This is complicated because module definitions are heavily overloaded
  // and support an anonymous function, module class, or options object
  _addModuleDefinition: function(parentModule, module, def, args){
    var fn = this._getDefine(def);
    var startWithParent = this._getStartWithParent(def, module);

    if (fn){
      module.addDefinition(fn, args);
    }

    this._addStartWithParent(parentModule, module, startWithParent);
  },

  _getStartWithParent: function(def, module) {
    var swp;

    if (_.isFunction(def) && (def.prototype instanceof Marionette.Module)) {
      swp = module.constructor.prototype.startWithParent;
      return _.isUndefined(swp) ? true : swp;
    }

    if (_.isObject(def)){
      swp = def.startWithParent;
      return _.isUndefined(swp) ? true : swp;
    }

    return true;
  },

  _getDefine: function(def) {
    if (_.isFunction(def) && !(def.prototype instanceof Marionette.Module)) {
      return def;
    }

    if (_.isObject(def)){
      return def.define;
    }

    return null;
  },

  _addStartWithParent: function(parentModule, module, startWithParent) {
    module.startWithParent = module.startWithParent && startWithParent;

    if (!module.startWithParent || !!module.startWithParentIsConfigured){
      return;
    }

    module.startWithParentIsConfigured = true;

    parentModule.addInitializer(function(options){
      if (module.startWithParent){
        module.start(options);
      }
    });
  }
});


  return Marionette;
})(this, Backbone, _);

//! moment.js
//! version : 2.7.0
//! authors : Tim Wood, Iskren Chernev, Moment.js contributors
//! license : MIT
//! momentjs.com

(function (undefined) {

    /************************************
        Constants
    ************************************/

    var moment,
        VERSION = "2.7.0",
        // the global-scope this is NOT the global object in Node.js
        globalScope = typeof global !== 'undefined' ? global : this,
        oldGlobalMoment,
        round = Math.round,
        i,

        YEAR = 0,
        MONTH = 1,
        DATE = 2,
        HOUR = 3,
        MINUTE = 4,
        SECOND = 5,
        MILLISECOND = 6,

        // internal storage for language config files
        languages = {},

        // moment internal properties
        momentProperties = {
            _isAMomentObject: null,
            _i : null,
            _f : null,
            _l : null,
            _strict : null,
            _tzm : null,
            _isUTC : null,
            _offset : null,  // optional. Combine with _isUTC
            _pf : null,
            _lang : null  // optional
        },

        // check for nodeJS
        hasModule = (typeof module !== 'undefined' && module.exports),

        // ASP.NET json date format regex
        aspNetJsonRegex = /^\/?Date\((\-?\d+)/i,
        aspNetTimeSpanJsonRegex = /(\-)?(?:(\d*)\.)?(\d+)\:(\d+)(?:\:(\d+)\.?(\d{3})?)?/,

        // from http://docs.closure-library.googlecode.com/git/closure_goog_date_date.js.source.html
        // somewhat more in line with 4.4.3.2 2004 spec, but allows decimal anywhere
        isoDurationRegex = /^(-)?P(?:(?:([0-9,.]*)Y)?(?:([0-9,.]*)M)?(?:([0-9,.]*)D)?(?:T(?:([0-9,.]*)H)?(?:([0-9,.]*)M)?(?:([0-9,.]*)S)?)?|([0-9,.]*)W)$/,

        // format tokens
        formattingTokens = /(\[[^\[]*\])|(\\)?(Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|Q|YYYYYY|YYYYY|YYYY|YY|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|mm?|ss?|S{1,4}|X|zz?|ZZ?|.)/g,
        localFormattingTokens = /(\[[^\[]*\])|(\\)?(LT|LL?L?L?|l{1,4})/g,

        // parsing token regexes
        parseTokenOneOrTwoDigits = /\d\d?/, // 0 - 99
        parseTokenOneToThreeDigits = /\d{1,3}/, // 0 - 999
        parseTokenOneToFourDigits = /\d{1,4}/, // 0 - 9999
        parseTokenOneToSixDigits = /[+\-]?\d{1,6}/, // -999,999 - 999,999
        parseTokenDigits = /\d+/, // nonzero number of digits
        parseTokenWord = /[0-9]*['a-z\u00A0-\u05FF\u0700-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+|[\u0600-\u06FF\/]+(\s*?[\u0600-\u06FF]+){1,2}/i, // any word (or two) characters or numbers including two/three word month in arabic.
        parseTokenTimezone = /Z|[\+\-]\d\d:?\d\d/gi, // +00:00 -00:00 +0000 -0000 or Z
        parseTokenT = /T/i, // T (ISO separator)
        parseTokenTimestampMs = /[\+\-]?\d+(\.\d{1,3})?/, // 123456789 123456789.123
        parseTokenOrdinal = /\d{1,2}/,

        //strict parsing regexes
        parseTokenOneDigit = /\d/, // 0 - 9
        parseTokenTwoDigits = /\d\d/, // 00 - 99
        parseTokenThreeDigits = /\d{3}/, // 000 - 999
        parseTokenFourDigits = /\d{4}/, // 0000 - 9999
        parseTokenSixDigits = /[+-]?\d{6}/, // -999,999 - 999,999
        parseTokenSignedNumber = /[+-]?\d+/, // -inf - inf

        // iso 8601 regex
        // 0000-00-00 0000-W00 or 0000-W00-0 + T + 00 or 00:00 or 00:00:00 or 00:00:00.000 + +00:00 or +0000 or +00)
        isoRegex = /^\s*(?:[+-]\d{6}|\d{4})-(?:(\d\d-\d\d)|(W\d\d$)|(W\d\d-\d)|(\d\d\d))((T| )(\d\d(:\d\d(:\d\d(\.\d+)?)?)?)?([\+\-]\d\d(?::?\d\d)?|\s*Z)?)?$/,

        isoFormat = 'YYYY-MM-DDTHH:mm:ssZ',

        isoDates = [
            ['YYYYYY-MM-DD', /[+-]\d{6}-\d{2}-\d{2}/],
            ['YYYY-MM-DD', /\d{4}-\d{2}-\d{2}/],
            ['GGGG-[W]WW-E', /\d{4}-W\d{2}-\d/],
            ['GGGG-[W]WW', /\d{4}-W\d{2}/],
            ['YYYY-DDD', /\d{4}-\d{3}/]
        ],

        // iso time formats and regexes
        isoTimes = [
            ['HH:mm:ss.SSSS', /(T| )\d\d:\d\d:\d\d\.\d+/],
            ['HH:mm:ss', /(T| )\d\d:\d\d:\d\d/],
            ['HH:mm', /(T| )\d\d:\d\d/],
            ['HH', /(T| )\d\d/]
        ],

        // timezone chunker "+10:00" > ["10", "00"] or "-1530" > ["-15", "30"]
        parseTimezoneChunker = /([\+\-]|\d\d)/gi,

        // getter and setter names
        proxyGettersAndSetters = 'Date|Hours|Minutes|Seconds|Milliseconds'.split('|'),
        unitMillisecondFactors = {
            'Milliseconds' : 1,
            'Seconds' : 1e3,
            'Minutes' : 6e4,
            'Hours' : 36e5,
            'Days' : 864e5,
            'Months' : 2592e6,
            'Years' : 31536e6
        },

        unitAliases = {
            ms : 'millisecond',
            s : 'second',
            m : 'minute',
            h : 'hour',
            d : 'day',
            D : 'date',
            w : 'week',
            W : 'isoWeek',
            M : 'month',
            Q : 'quarter',
            y : 'year',
            DDD : 'dayOfYear',
            e : 'weekday',
            E : 'isoWeekday',
            gg: 'weekYear',
            GG: 'isoWeekYear'
        },

        camelFunctions = {
            dayofyear : 'dayOfYear',
            isoweekday : 'isoWeekday',
            isoweek : 'isoWeek',
            weekyear : 'weekYear',
            isoweekyear : 'isoWeekYear'
        },

        // format function strings
        formatFunctions = {},

        // default relative time thresholds
        relativeTimeThresholds = {
          s: 45,   //seconds to minutes
          m: 45,   //minutes to hours
          h: 22,   //hours to days
          dd: 25,  //days to month (month == 1)
          dm: 45,  //days to months (months > 1)
          dy: 345  //days to year
        },

        // tokens to ordinalize and pad
        ordinalizeTokens = 'DDD w W M D d'.split(' '),
        paddedTokens = 'M D H h m s w W'.split(' '),

        formatTokenFunctions = {
            M    : function () {
                return this.month() + 1;
            },
            MMM  : function (format) {
                return this.lang().monthsShort(this, format);
            },
            MMMM : function (format) {
                return this.lang().months(this, format);
            },
            D    : function () {
                return this.date();
            },
            DDD  : function () {
                return this.dayOfYear();
            },
            d    : function () {
                return this.day();
            },
            dd   : function (format) {
                return this.lang().weekdaysMin(this, format);
            },
            ddd  : function (format) {
                return this.lang().weekdaysShort(this, format);
            },
            dddd : function (format) {
                return this.lang().weekdays(this, format);
            },
            w    : function () {
                return this.week();
            },
            W    : function () {
                return this.isoWeek();
            },
            YY   : function () {
                return leftZeroFill(this.year() % 100, 2);
            },
            YYYY : function () {
                return leftZeroFill(this.year(), 4);
            },
            YYYYY : function () {
                return leftZeroFill(this.year(), 5);
            },
            YYYYYY : function () {
                var y = this.year(), sign = y >= 0 ? '+' : '-';
                return sign + leftZeroFill(Math.abs(y), 6);
            },
            gg   : function () {
                return leftZeroFill(this.weekYear() % 100, 2);
            },
            gggg : function () {
                return leftZeroFill(this.weekYear(), 4);
            },
            ggggg : function () {
                return leftZeroFill(this.weekYear(), 5);
            },
            GG   : function () {
                return leftZeroFill(this.isoWeekYear() % 100, 2);
            },
            GGGG : function () {
                return leftZeroFill(this.isoWeekYear(), 4);
            },
            GGGGG : function () {
                return leftZeroFill(this.isoWeekYear(), 5);
            },
            e : function () {
                return this.weekday();
            },
            E : function () {
                return this.isoWeekday();
            },
            a    : function () {
                return this.lang().meridiem(this.hours(), this.minutes(), true);
            },
            A    : function () {
                return this.lang().meridiem(this.hours(), this.minutes(), false);
            },
            H    : function () {
                return this.hours();
            },
            h    : function () {
                return this.hours() % 12 || 12;
            },
            m    : function () {
                return this.minutes();
            },
            s    : function () {
                return this.seconds();
            },
            S    : function () {
                return toInt(this.milliseconds() / 100);
            },
            SS   : function () {
                return leftZeroFill(toInt(this.milliseconds() / 10), 2);
            },
            SSS  : function () {
                return leftZeroFill(this.milliseconds(), 3);
            },
            SSSS : function () {
                return leftZeroFill(this.milliseconds(), 3);
            },
            Z    : function () {
                var a = -this.zone(),
                    b = "+";
                if (a < 0) {
                    a = -a;
                    b = "-";
                }
                return b + leftZeroFill(toInt(a / 60), 2) + ":" + leftZeroFill(toInt(a) % 60, 2);
            },
            ZZ   : function () {
                var a = -this.zone(),
                    b = "+";
                if (a < 0) {
                    a = -a;
                    b = "-";
                }
                return b + leftZeroFill(toInt(a / 60), 2) + leftZeroFill(toInt(a) % 60, 2);
            },
            z : function () {
                return this.zoneAbbr();
            },
            zz : function () {
                return this.zoneName();
            },
            X    : function () {
                return this.unix();
            },
            Q : function () {
                return this.quarter();
            }
        },

        lists = ['months', 'monthsShort', 'weekdays', 'weekdaysShort', 'weekdaysMin'];

    // Pick the first defined of two or three arguments. dfl comes from
    // default.
    function dfl(a, b, c) {
        switch (arguments.length) {
            case 2: return a != null ? a : b;
            case 3: return a != null ? a : b != null ? b : c;
            default: throw new Error("Implement me");
        }
    }

    function defaultParsingFlags() {
        // We need to deep clone this object, and es5 standard is not very
        // helpful.
        return {
            empty : false,
            unusedTokens : [],
            unusedInput : [],
            overflow : -2,
            charsLeftOver : 0,
            nullInput : false,
            invalidMonth : null,
            invalidFormat : false,
            userInvalidated : false,
            iso: false
        };
    }

    function deprecate(msg, fn) {
        var firstTime = true;
        function printMsg() {
            if (moment.suppressDeprecationWarnings === false &&
                    typeof console !== 'undefined' && console.warn) {
                console.warn("Deprecation warning: " + msg);
            }
        }
        return extend(function () {
            if (firstTime) {
                printMsg();
                firstTime = false;
            }
            return fn.apply(this, arguments);
        }, fn);
    }

    function padToken(func, count) {
        return function (a) {
            return leftZeroFill(func.call(this, a), count);
        };
    }
    function ordinalizeToken(func, period) {
        return function (a) {
            return this.lang().ordinal(func.call(this, a), period);
        };
    }

    while (ordinalizeTokens.length) {
        i = ordinalizeTokens.pop();
        formatTokenFunctions[i + 'o'] = ordinalizeToken(formatTokenFunctions[i], i);
    }
    while (paddedTokens.length) {
        i = paddedTokens.pop();
        formatTokenFunctions[i + i] = padToken(formatTokenFunctions[i], 2);
    }
    formatTokenFunctions.DDDD = padToken(formatTokenFunctions.DDD, 3);


    /************************************
        Constructors
    ************************************/

    function Language() {

    }

    // Moment prototype object
    function Moment(config) {
        checkOverflow(config);
        extend(this, config);
    }

    // Duration Constructor
    function Duration(duration) {
        var normalizedInput = normalizeObjectUnits(duration),
            years = normalizedInput.year || 0,
            quarters = normalizedInput.quarter || 0,
            months = normalizedInput.month || 0,
            weeks = normalizedInput.week || 0,
            days = normalizedInput.day || 0,
            hours = normalizedInput.hour || 0,
            minutes = normalizedInput.minute || 0,
            seconds = normalizedInput.second || 0,
            milliseconds = normalizedInput.millisecond || 0;

        // representation for dateAddRemove
        this._milliseconds = +milliseconds +
            seconds * 1e3 + // 1000
            minutes * 6e4 + // 1000 * 60
            hours * 36e5; // 1000 * 60 * 60
        // Because of dateAddRemove treats 24 hours as different from a
        // day when working around DST, we need to store them separately
        this._days = +days +
            weeks * 7;
        // It is impossible translate months into days without knowing
        // which months you are are talking about, so we have to store
        // it separately.
        this._months = +months +
            quarters * 3 +
            years * 12;

        this._data = {};

        this._bubble();
    }

    /************************************
        Helpers
    ************************************/


    function extend(a, b) {
        for (var i in b) {
            if (b.hasOwnProperty(i)) {
                a[i] = b[i];
            }
        }

        if (b.hasOwnProperty("toString")) {
            a.toString = b.toString;
        }

        if (b.hasOwnProperty("valueOf")) {
            a.valueOf = b.valueOf;
        }

        return a;
    }

    function cloneMoment(m) {
        var result = {}, i;
        for (i in m) {
            if (m.hasOwnProperty(i) && momentProperties.hasOwnProperty(i)) {
                result[i] = m[i];
            }
        }

        return result;
    }

    function absRound(number) {
        if (number < 0) {
            return Math.ceil(number);
        } else {
            return Math.floor(number);
        }
    }

    // left zero fill a number
    // see http://jsperf.com/left-zero-filling for performance comparison
    function leftZeroFill(number, targetLength, forceSign) {
        var output = '' + Math.abs(number),
            sign = number >= 0;

        while (output.length < targetLength) {
            output = '0' + output;
        }
        return (sign ? (forceSign ? '+' : '') : '-') + output;
    }

    // helper function for _.addTime and _.subtractTime
    function addOrSubtractDurationFromMoment(mom, duration, isAdding, updateOffset) {
        var milliseconds = duration._milliseconds,
            days = duration._days,
            months = duration._months;
        updateOffset = updateOffset == null ? true : updateOffset;

        if (milliseconds) {
            mom._d.setTime(+mom._d + milliseconds * isAdding);
        }
        if (days) {
            rawSetter(mom, 'Date', rawGetter(mom, 'Date') + days * isAdding);
        }
        if (months) {
            rawMonthSetter(mom, rawGetter(mom, 'Month') + months * isAdding);
        }
        if (updateOffset) {
            moment.updateOffset(mom, days || months);
        }
    }

    // check if is an array
    function isArray(input) {
        return Object.prototype.toString.call(input) === '[object Array]';
    }

    function isDate(input) {
        return  Object.prototype.toString.call(input) === '[object Date]' ||
                input instanceof Date;
    }

    // compare two arrays, return the number of differences
    function compareArrays(array1, array2, dontConvert) {
        var len = Math.min(array1.length, array2.length),
            lengthDiff = Math.abs(array1.length - array2.length),
            diffs = 0,
            i;
        for (i = 0; i < len; i++) {
            if ((dontConvert && array1[i] !== array2[i]) ||
                (!dontConvert && toInt(array1[i]) !== toInt(array2[i]))) {
                diffs++;
            }
        }
        return diffs + lengthDiff;
    }

    function normalizeUnits(units) {
        if (units) {
            var lowered = units.toLowerCase().replace(/(.)s$/, '$1');
            units = unitAliases[units] || camelFunctions[lowered] || lowered;
        }
        return units;
    }

    function normalizeObjectUnits(inputObject) {
        var normalizedInput = {},
            normalizedProp,
            prop;

        for (prop in inputObject) {
            if (inputObject.hasOwnProperty(prop)) {
                normalizedProp = normalizeUnits(prop);
                if (normalizedProp) {
                    normalizedInput[normalizedProp] = inputObject[prop];
                }
            }
        }

        return normalizedInput;
    }

    function makeList(field) {
        var count, setter;

        if (field.indexOf('week') === 0) {
            count = 7;
            setter = 'day';
        }
        else if (field.indexOf('month') === 0) {
            count = 12;
            setter = 'month';
        }
        else {
            return;
        }

        moment[field] = function (format, index) {
            var i, getter,
                method = moment.fn._lang[field],
                results = [];

            if (typeof format === 'number') {
                index = format;
                format = undefined;
            }

            getter = function (i) {
                var m = moment().utc().set(setter, i);
                return method.call(moment.fn._lang, m, format || '');
            };

            if (index != null) {
                return getter(index);
            }
            else {
                for (i = 0; i < count; i++) {
                    results.push(getter(i));
                }
                return results;
            }
        };
    }

    function toInt(argumentForCoercion) {
        var coercedNumber = +argumentForCoercion,
            value = 0;

        if (coercedNumber !== 0 && isFinite(coercedNumber)) {
            if (coercedNumber >= 0) {
                value = Math.floor(coercedNumber);
            } else {
                value = Math.ceil(coercedNumber);
            }
        }

        return value;
    }

    function daysInMonth(year, month) {
        return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    }

    function weeksInYear(year, dow, doy) {
        return weekOfYear(moment([year, 11, 31 + dow - doy]), dow, doy).week;
    }

    function daysInYear(year) {
        return isLeapYear(year) ? 366 : 365;
    }

    function isLeapYear(year) {
        return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    }

    function checkOverflow(m) {
        var overflow;
        if (m._a && m._pf.overflow === -2) {
            overflow =
                m._a[MONTH] < 0 || m._a[MONTH] > 11 ? MONTH :
                m._a[DATE] < 1 || m._a[DATE] > daysInMonth(m._a[YEAR], m._a[MONTH]) ? DATE :
                m._a[HOUR] < 0 || m._a[HOUR] > 23 ? HOUR :
                m._a[MINUTE] < 0 || m._a[MINUTE] > 59 ? MINUTE :
                m._a[SECOND] < 0 || m._a[SECOND] > 59 ? SECOND :
                m._a[MILLISECOND] < 0 || m._a[MILLISECOND] > 999 ? MILLISECOND :
                -1;

            if (m._pf._overflowDayOfYear && (overflow < YEAR || overflow > DATE)) {
                overflow = DATE;
            }

            m._pf.overflow = overflow;
        }
    }

    function isValid(m) {
        if (m._isValid == null) {
            m._isValid = !isNaN(m._d.getTime()) &&
                m._pf.overflow < 0 &&
                !m._pf.empty &&
                !m._pf.invalidMonth &&
                !m._pf.nullInput &&
                !m._pf.invalidFormat &&
                !m._pf.userInvalidated;

            if (m._strict) {
                m._isValid = m._isValid &&
                    m._pf.charsLeftOver === 0 &&
                    m._pf.unusedTokens.length === 0;
            }
        }
        return m._isValid;
    }

    function normalizeLanguage(key) {
        return key ? key.toLowerCase().replace('_', '-') : key;
    }

    // Return a moment from input, that is local/utc/zone equivalent to model.
    function makeAs(input, model) {
        return model._isUTC ? moment(input).zone(model._offset || 0) :
            moment(input).local();
    }

    /************************************
        Languages
    ************************************/


    extend(Language.prototype, {

        set : function (config) {
            var prop, i;
            for (i in config) {
                prop = config[i];
                if (typeof prop === 'function') {
                    this[i] = prop;
                } else {
                    this['_' + i] = prop;
                }
            }
        },

        _months : "January_February_March_April_May_June_July_August_September_October_November_December".split("_"),
        months : function (m) {
            return this._months[m.month()];
        },

        _monthsShort : "Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec".split("_"),
        monthsShort : function (m) {
            return this._monthsShort[m.month()];
        },

        monthsParse : function (monthName) {
            var i, mom, regex;

            if (!this._monthsParse) {
                this._monthsParse = [];
            }

            for (i = 0; i < 12; i++) {
                // make the regex if we don't have it already
                if (!this._monthsParse[i]) {
                    mom = moment.utc([2000, i]);
                    regex = '^' + this.months(mom, '') + '|^' + this.monthsShort(mom, '');
                    this._monthsParse[i] = new RegExp(regex.replace('.', ''), 'i');
                }
                // test the regex
                if (this._monthsParse[i].test(monthName)) {
                    return i;
                }
            }
        },

        _weekdays : "Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),
        weekdays : function (m) {
            return this._weekdays[m.day()];
        },

        _weekdaysShort : "Sun_Mon_Tue_Wed_Thu_Fri_Sat".split("_"),
        weekdaysShort : function (m) {
            return this._weekdaysShort[m.day()];
        },

        _weekdaysMin : "Su_Mo_Tu_We_Th_Fr_Sa".split("_"),
        weekdaysMin : function (m) {
            return this._weekdaysMin[m.day()];
        },

        weekdaysParse : function (weekdayName) {
            var i, mom, regex;

            if (!this._weekdaysParse) {
                this._weekdaysParse = [];
            }

            for (i = 0; i < 7; i++) {
                // make the regex if we don't have it already
                if (!this._weekdaysParse[i]) {
                    mom = moment([2000, 1]).day(i);
                    regex = '^' + this.weekdays(mom, '') + '|^' + this.weekdaysShort(mom, '') + '|^' + this.weekdaysMin(mom, '');
                    this._weekdaysParse[i] = new RegExp(regex.replace('.', ''), 'i');
                }
                // test the regex
                if (this._weekdaysParse[i].test(weekdayName)) {
                    return i;
                }
            }
        },

        _longDateFormat : {
            LT : "h:mm A",
            L : "MM/DD/YYYY",
            LL : "MMMM D YYYY",
            LLL : "MMMM D YYYY LT",
            LLLL : "dddd, MMMM D YYYY LT"
        },
        longDateFormat : function (key) {
            var output = this._longDateFormat[key];
            if (!output && this._longDateFormat[key.toUpperCase()]) {
                output = this._longDateFormat[key.toUpperCase()].replace(/MMMM|MM|DD|dddd/g, function (val) {
                    return val.slice(1);
                });
                this._longDateFormat[key] = output;
            }
            return output;
        },

        isPM : function (input) {
            // IE8 Quirks Mode & IE7 Standards Mode do not allow accessing strings like arrays
            // Using charAt should be more compatible.
            return ((input + '').toLowerCase().charAt(0) === 'p');
        },

        _meridiemParse : /[ap]\.?m?\.?/i,
        meridiem : function (hours, minutes, isLower) {
            if (hours > 11) {
                return isLower ? 'pm' : 'PM';
            } else {
                return isLower ? 'am' : 'AM';
            }
        },

        _calendar : {
            sameDay : '[Today at] LT',
            nextDay : '[Tomorrow at] LT',
            nextWeek : 'dddd [at] LT',
            lastDay : '[Yesterday at] LT',
            lastWeek : '[Last] dddd [at] LT',
            sameElse : 'L'
        },
        calendar : function (key, mom) {
            var output = this._calendar[key];
            return typeof output === 'function' ? output.apply(mom) : output;
        },

        _relativeTime : {
            future : "in %s",
            past : "%s ago",
            s : "a few seconds",
            m : "a minute",
            mm : "%d minutes",
            h : "an hour",
            hh : "%d hours",
            d : "a day",
            dd : "%d days",
            M : "a month",
            MM : "%d months",
            y : "a year",
            yy : "%d years"
        },
        relativeTime : function (number, withoutSuffix, string, isFuture) {
            var output = this._relativeTime[string];
            return (typeof output === 'function') ?
                output(number, withoutSuffix, string, isFuture) :
                output.replace(/%d/i, number);
        },
        pastFuture : function (diff, output) {
            var format = this._relativeTime[diff > 0 ? 'future' : 'past'];
            return typeof format === 'function' ? format(output) : format.replace(/%s/i, output);
        },

        ordinal : function (number) {
            return this._ordinal.replace("%d", number);
        },
        _ordinal : "%d",

        preparse : function (string) {
            return string;
        },

        postformat : function (string) {
            return string;
        },

        week : function (mom) {
            return weekOfYear(mom, this._week.dow, this._week.doy).week;
        },

        _week : {
            dow : 0, // Sunday is the first day of the week.
            doy : 6  // The week that contains Jan 1st is the first week of the year.
        },

        _invalidDate: 'Invalid date',
        invalidDate: function () {
            return this._invalidDate;
        }
    });

    // Loads a language definition into the `languages` cache.  The function
    // takes a key and optionally values.  If not in the browser and no values
    // are provided, it will load the language file module.  As a convenience,
    // this function also returns the language values.
    function loadLang(key, values) {
        values.abbr = key;
        if (!languages[key]) {
            languages[key] = new Language();
        }
        languages[key].set(values);
        return languages[key];
    }

    // Remove a language from the `languages` cache. Mostly useful in tests.
    function unloadLang(key) {
        delete languages[key];
    }

    // Determines which language definition to use and returns it.
    //
    // With no parameters, it will return the global language.  If you
    // pass in a language key, such as 'en', it will return the
    // definition for 'en', so long as 'en' has already been loaded using
    // moment.lang.
    function getLangDefinition(key) {
        var i = 0, j, lang, next, split,
            get = function (k) {
                if (!languages[k] && hasModule) {
                    try {
                        require('./lang/' + k);
                    } catch (e) { }
                }
                return languages[k];
            };

        if (!key) {
            return moment.fn._lang;
        }

        if (!isArray(key)) {
            //short-circuit everything else
            lang = get(key);
            if (lang) {
                return lang;
            }
            key = [key];
        }

        //pick the language from the array
        //try ['en-au', 'en-gb'] as 'en-au', 'en-gb', 'en', as in move through the list trying each
        //substring from most specific to least, but move to the next array item if it's a more specific variant than the current root
        while (i < key.length) {
            split = normalizeLanguage(key[i]).split('-');
            j = split.length;
            next = normalizeLanguage(key[i + 1]);
            next = next ? next.split('-') : null;
            while (j > 0) {
                lang = get(split.slice(0, j).join('-'));
                if (lang) {
                    return lang;
                }
                if (next && next.length >= j && compareArrays(split, next, true) >= j - 1) {
                    //the next array item is better than a shallower substring of this one
                    break;
                }
                j--;
            }
            i++;
        }
        return moment.fn._lang;
    }

    /************************************
        Formatting
    ************************************/


    function removeFormattingTokens(input) {
        if (input.match(/\[[\s\S]/)) {
            return input.replace(/^\[|\]$/g, "");
        }
        return input.replace(/\\/g, "");
    }

    function makeFormatFunction(format) {
        var array = format.match(formattingTokens), i, length;

        for (i = 0, length = array.length; i < length; i++) {
            if (formatTokenFunctions[array[i]]) {
                array[i] = formatTokenFunctions[array[i]];
            } else {
                array[i] = removeFormattingTokens(array[i]);
            }
        }

        return function (mom) {
            var output = "";
            for (i = 0; i < length; i++) {
                output += array[i] instanceof Function ? array[i].call(mom, format) : array[i];
            }
            return output;
        };
    }

    // format date using native date object
    function formatMoment(m, format) {

        if (!m.isValid()) {
            return m.lang().invalidDate();
        }

        format = expandFormat(format, m.lang());

        if (!formatFunctions[format]) {
            formatFunctions[format] = makeFormatFunction(format);
        }

        return formatFunctions[format](m);
    }

    function expandFormat(format, lang) {
        var i = 5;

        function replaceLongDateFormatTokens(input) {
            return lang.longDateFormat(input) || input;
        }

        localFormattingTokens.lastIndex = 0;
        while (i >= 0 && localFormattingTokens.test(format)) {
            format = format.replace(localFormattingTokens, replaceLongDateFormatTokens);
            localFormattingTokens.lastIndex = 0;
            i -= 1;
        }

        return format;
    }


    /************************************
        Parsing
    ************************************/


    // get the regex to find the next token
    function getParseRegexForToken(token, config) {
        var a, strict = config._strict;
        switch (token) {
        case 'Q':
            return parseTokenOneDigit;
        case 'DDDD':
            return parseTokenThreeDigits;
        case 'YYYY':
        case 'GGGG':
        case 'gggg':
            return strict ? parseTokenFourDigits : parseTokenOneToFourDigits;
        case 'Y':
        case 'G':
        case 'g':
            return parseTokenSignedNumber;
        case 'YYYYYY':
        case 'YYYYY':
        case 'GGGGG':
        case 'ggggg':
            return strict ? parseTokenSixDigits : parseTokenOneToSixDigits;
        case 'S':
            if (strict) { return parseTokenOneDigit; }
            /* falls through */
        case 'SS':
            if (strict) { return parseTokenTwoDigits; }
            /* falls through */
        case 'SSS':
            if (strict) { return parseTokenThreeDigits; }
            /* falls through */
        case 'DDD':
            return parseTokenOneToThreeDigits;
        case 'MMM':
        case 'MMMM':
        case 'dd':
        case 'ddd':
        case 'dddd':
            return parseTokenWord;
        case 'a':
        case 'A':
            return getLangDefinition(config._l)._meridiemParse;
        case 'X':
            return parseTokenTimestampMs;
        case 'Z':
        case 'ZZ':
            return parseTokenTimezone;
        case 'T':
            return parseTokenT;
        case 'SSSS':
            return parseTokenDigits;
        case 'MM':
        case 'DD':
        case 'YY':
        case 'GG':
        case 'gg':
        case 'HH':
        case 'hh':
        case 'mm':
        case 'ss':
        case 'ww':
        case 'WW':
            return strict ? parseTokenTwoDigits : parseTokenOneOrTwoDigits;
        case 'M':
        case 'D':
        case 'd':
        case 'H':
        case 'h':
        case 'm':
        case 's':
        case 'w':
        case 'W':
        case 'e':
        case 'E':
            return parseTokenOneOrTwoDigits;
        case 'Do':
            return parseTokenOrdinal;
        default :
            a = new RegExp(regexpEscape(unescapeFormat(token.replace('\\', '')), "i"));
            return a;
        }
    }

    function timezoneMinutesFromString(string) {
        string = string || "";
        var possibleTzMatches = (string.match(parseTokenTimezone) || []),
            tzChunk = possibleTzMatches[possibleTzMatches.length - 1] || [],
            parts = (tzChunk + '').match(parseTimezoneChunker) || ['-', 0, 0],
            minutes = +(parts[1] * 60) + toInt(parts[2]);

        return parts[0] === '+' ? -minutes : minutes;
    }

    // function to convert string input to date
    function addTimeToArrayFromToken(token, input, config) {
        var a, datePartArray = config._a;

        switch (token) {
        // QUARTER
        case 'Q':
            if (input != null) {
                datePartArray[MONTH] = (toInt(input) - 1) * 3;
            }
            break;
        // MONTH
        case 'M' : // fall through to MM
        case 'MM' :
            if (input != null) {
                datePartArray[MONTH] = toInt(input) - 1;
            }
            break;
        case 'MMM' : // fall through to MMMM
        case 'MMMM' :
            a = getLangDefinition(config._l).monthsParse(input);
            // if we didn't find a month name, mark the date as invalid.
            if (a != null) {
                datePartArray[MONTH] = a;
            } else {
                config._pf.invalidMonth = input;
            }
            break;
        // DAY OF MONTH
        case 'D' : // fall through to DD
        case 'DD' :
            if (input != null) {
                datePartArray[DATE] = toInt(input);
            }
            break;
        case 'Do' :
            if (input != null) {
                datePartArray[DATE] = toInt(parseInt(input, 10));
            }
            break;
        // DAY OF YEAR
        case 'DDD' : // fall through to DDDD
        case 'DDDD' :
            if (input != null) {
                config._dayOfYear = toInt(input);
            }

            break;
        // YEAR
        case 'YY' :
            datePartArray[YEAR] = moment.parseTwoDigitYear(input);
            break;
        case 'YYYY' :
        case 'YYYYY' :
        case 'YYYYYY' :
            datePartArray[YEAR] = toInt(input);
            break;
        // AM / PM
        case 'a' : // fall through to A
        case 'A' :
            config._isPm = getLangDefinition(config._l).isPM(input);
            break;
        // 24 HOUR
        case 'H' : // fall through to hh
        case 'HH' : // fall through to hh
        case 'h' : // fall through to hh
        case 'hh' :
            datePartArray[HOUR] = toInt(input);
            break;
        // MINUTE
        case 'm' : // fall through to mm
        case 'mm' :
            datePartArray[MINUTE] = toInt(input);
            break;
        // SECOND
        case 's' : // fall through to ss
        case 'ss' :
            datePartArray[SECOND] = toInt(input);
            break;
        // MILLISECOND
        case 'S' :
        case 'SS' :
        case 'SSS' :
        case 'SSSS' :
            datePartArray[MILLISECOND] = toInt(('0.' + input) * 1000);
            break;
        // UNIX TIMESTAMP WITH MS
        case 'X':
            config._d = new Date(parseFloat(input) * 1000);
            break;
        // TIMEZONE
        case 'Z' : // fall through to ZZ
        case 'ZZ' :
            config._useUTC = true;
            config._tzm = timezoneMinutesFromString(input);
            break;
        // WEEKDAY - human
        case 'dd':
        case 'ddd':
        case 'dddd':
            a = getLangDefinition(config._l).weekdaysParse(input);
            // if we didn't get a weekday name, mark the date as invalid
            if (a != null) {
                config._w = config._w || {};
                config._w['d'] = a;
            } else {
                config._pf.invalidWeekday = input;
            }
            break;
        // WEEK, WEEK DAY - numeric
        case 'w':
        case 'ww':
        case 'W':
        case 'WW':
        case 'd':
        case 'e':
        case 'E':
            token = token.substr(0, 1);
            /* falls through */
        case 'gggg':
        case 'GGGG':
        case 'GGGGG':
            token = token.substr(0, 2);
            if (input) {
                config._w = config._w || {};
                config._w[token] = toInt(input);
            }
            break;
        case 'gg':
        case 'GG':
            config._w = config._w || {};
            config._w[token] = moment.parseTwoDigitYear(input);
        }
    }

    function dayOfYearFromWeekInfo(config) {
        var w, weekYear, week, weekday, dow, doy, temp, lang;

        w = config._w;
        if (w.GG != null || w.W != null || w.E != null) {
            dow = 1;
            doy = 4;

            // TODO: We need to take the current isoWeekYear, but that depends on
            // how we interpret now (local, utc, fixed offset). So create
            // a now version of current config (take local/utc/offset flags, and
            // create now).
            weekYear = dfl(w.GG, config._a[YEAR], weekOfYear(moment(), 1, 4).year);
            week = dfl(w.W, 1);
            weekday = dfl(w.E, 1);
        } else {
            lang = getLangDefinition(config._l);
            dow = lang._week.dow;
            doy = lang._week.doy;

            weekYear = dfl(w.gg, config._a[YEAR], weekOfYear(moment(), dow, doy).year);
            week = dfl(w.w, 1);

            if (w.d != null) {
                // weekday -- low day numbers are considered next week
                weekday = w.d;
                if (weekday < dow) {
                    ++week;
                }
            } else if (w.e != null) {
                // local weekday -- counting starts from begining of week
                weekday = w.e + dow;
            } else {
                // default to begining of week
                weekday = dow;
            }
        }
        temp = dayOfYearFromWeeks(weekYear, week, weekday, doy, dow);

        config._a[YEAR] = temp.year;
        config._dayOfYear = temp.dayOfYear;
    }

    // convert an array to a date.
    // the array should mirror the parameters below
    // note: all values past the year are optional and will default to the lowest possible value.
    // [year, month, day , hour, minute, second, millisecond]
    function dateFromConfig(config) {
        var i, date, input = [], currentDate, yearToUse;

        if (config._d) {
            return;
        }

        currentDate = currentDateArray(config);

        //compute day of the year from weeks and weekdays
        if (config._w && config._a[DATE] == null && config._a[MONTH] == null) {
            dayOfYearFromWeekInfo(config);
        }

        //if the day of the year is set, figure out what it is
        if (config._dayOfYear) {
            yearToUse = dfl(config._a[YEAR], currentDate[YEAR]);

            if (config._dayOfYear > daysInYear(yearToUse)) {
                config._pf._overflowDayOfYear = true;
            }

            date = makeUTCDate(yearToUse, 0, config._dayOfYear);
            config._a[MONTH] = date.getUTCMonth();
            config._a[DATE] = date.getUTCDate();
        }

        // Default to current date.
        // * if no year, month, day of month are given, default to today
        // * if day of month is given, default month and year
        // * if month is given, default only year
        // * if year is given, don't default anything
        for (i = 0; i < 3 && config._a[i] == null; ++i) {
            config._a[i] = input[i] = currentDate[i];
        }

        // Zero out whatever was not defaulted, including time
        for (; i < 7; i++) {
            config._a[i] = input[i] = (config._a[i] == null) ? (i === 2 ? 1 : 0) : config._a[i];
        }

        config._d = (config._useUTC ? makeUTCDate : makeDate).apply(null, input);
        // Apply timezone offset from input. The actual zone can be changed
        // with parseZone.
        if (config._tzm != null) {
            config._d.setUTCMinutes(config._d.getUTCMinutes() + config._tzm);
        }
    }

    function dateFromObject(config) {
        var normalizedInput;

        if (config._d) {
            return;
        }

        normalizedInput = normalizeObjectUnits(config._i);
        config._a = [
            normalizedInput.year,
            normalizedInput.month,
            normalizedInput.day,
            normalizedInput.hour,
            normalizedInput.minute,
            normalizedInput.second,
            normalizedInput.millisecond
        ];

        dateFromConfig(config);
    }

    function currentDateArray(config) {
        var now = new Date();
        if (config._useUTC) {
            return [
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate()
            ];
        } else {
            return [now.getFullYear(), now.getMonth(), now.getDate()];
        }
    }

    // date from string and format string
    function makeDateFromStringAndFormat(config) {

        if (config._f === moment.ISO_8601) {
            parseISO(config);
            return;
        }

        config._a = [];
        config._pf.empty = true;

        // This array is used to make a Date, either with `new Date` or `Date.UTC`
        var lang = getLangDefinition(config._l),
            string = '' + config._i,
            i, parsedInput, tokens, token, skipped,
            stringLength = string.length,
            totalParsedInputLength = 0;

        tokens = expandFormat(config._f, lang).match(formattingTokens) || [];

        for (i = 0; i < tokens.length; i++) {
            token = tokens[i];
            parsedInput = (string.match(getParseRegexForToken(token, config)) || [])[0];
            if (parsedInput) {
                skipped = string.substr(0, string.indexOf(parsedInput));
                if (skipped.length > 0) {
                    config._pf.unusedInput.push(skipped);
                }
                string = string.slice(string.indexOf(parsedInput) + parsedInput.length);
                totalParsedInputLength += parsedInput.length;
            }
            // don't parse if it's not a known token
            if (formatTokenFunctions[token]) {
                if (parsedInput) {
                    config._pf.empty = false;
                }
                else {
                    config._pf.unusedTokens.push(token);
                }
                addTimeToArrayFromToken(token, parsedInput, config);
            }
            else if (config._strict && !parsedInput) {
                config._pf.unusedTokens.push(token);
            }
        }

        // add remaining unparsed input length to the string
        config._pf.charsLeftOver = stringLength - totalParsedInputLength;
        if (string.length > 0) {
            config._pf.unusedInput.push(string);
        }

        // handle am pm
        if (config._isPm && config._a[HOUR] < 12) {
            config._a[HOUR] += 12;
        }
        // if is 12 am, change hours to 0
        if (config._isPm === false && config._a[HOUR] === 12) {
            config._a[HOUR] = 0;
        }

        dateFromConfig(config);
        checkOverflow(config);
    }

    function unescapeFormat(s) {
        return s.replace(/\\(\[)|\\(\])|\[([^\]\[]*)\]|\\(.)/g, function (matched, p1, p2, p3, p4) {
            return p1 || p2 || p3 || p4;
        });
    }

    // Code from http://stackoverflow.com/questions/3561493/is-there-a-regexp-escape-function-in-javascript
    function regexpEscape(s) {
        return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    }

    // date from string and array of format strings
    function makeDateFromStringAndArray(config) {
        var tempConfig,
            bestMoment,

            scoreToBeat,
            i,
            currentScore;

        if (config._f.length === 0) {
            config._pf.invalidFormat = true;
            config._d = new Date(NaN);
            return;
        }

        for (i = 0; i < config._f.length; i++) {
            currentScore = 0;
            tempConfig = extend({}, config);
            tempConfig._pf = defaultParsingFlags();
            tempConfig._f = config._f[i];
            makeDateFromStringAndFormat(tempConfig);

            if (!isValid(tempConfig)) {
                continue;
            }

            // if there is any input that was not parsed add a penalty for that format
            currentScore += tempConfig._pf.charsLeftOver;

            //or tokens
            currentScore += tempConfig._pf.unusedTokens.length * 10;

            tempConfig._pf.score = currentScore;

            if (scoreToBeat == null || currentScore < scoreToBeat) {
                scoreToBeat = currentScore;
                bestMoment = tempConfig;
            }
        }

        extend(config, bestMoment || tempConfig);
    }

    // date from iso format
    function parseISO(config) {
        var i, l,
            string = config._i,
            match = isoRegex.exec(string);

        if (match) {
            config._pf.iso = true;
            for (i = 0, l = isoDates.length; i < l; i++) {
                if (isoDates[i][1].exec(string)) {
                    // match[5] should be "T" or undefined
                    config._f = isoDates[i][0] + (match[6] || " ");
                    break;
                }
            }
            for (i = 0, l = isoTimes.length; i < l; i++) {
                if (isoTimes[i][1].exec(string)) {
                    config._f += isoTimes[i][0];
                    break;
                }
            }
            if (string.match(parseTokenTimezone)) {
                config._f += "Z";
            }
            makeDateFromStringAndFormat(config);
        } else {
            config._isValid = false;
        }
    }

    // date from iso format or fallback
    function makeDateFromString(config) {
        parseISO(config);
        if (config._isValid === false) {
            delete config._isValid;
            moment.createFromInputFallback(config);
        }
    }

    function makeDateFromInput(config) {
        var input = config._i,
            matched = aspNetJsonRegex.exec(input);

        if (input === undefined) {
            config._d = new Date();
        } else if (matched) {
            config._d = new Date(+matched[1]);
        } else if (typeof input === 'string') {
            makeDateFromString(config);
        } else if (isArray(input)) {
            config._a = input.slice(0);
            dateFromConfig(config);
        } else if (isDate(input)) {
            config._d = new Date(+input);
        } else if (typeof(input) === 'object') {
            dateFromObject(config);
        } else if (typeof(input) === 'number') {
            // from milliseconds
            config._d = new Date(input);
        } else {
            moment.createFromInputFallback(config);
        }
    }

    function makeDate(y, m, d, h, M, s, ms) {
        //can't just apply() to create a date:
        //http://stackoverflow.com/questions/181348/instantiating-a-javascript-object-by-calling-prototype-constructor-apply
        var date = new Date(y, m, d, h, M, s, ms);

        //the date constructor doesn't accept years < 1970
        if (y < 1970) {
            date.setFullYear(y);
        }
        return date;
    }

    function makeUTCDate(y) {
        var date = new Date(Date.UTC.apply(null, arguments));
        if (y < 1970) {
            date.setUTCFullYear(y);
        }
        return date;
    }

    function parseWeekday(input, language) {
        if (typeof input === 'string') {
            if (!isNaN(input)) {
                input = parseInt(input, 10);
            }
            else {
                input = language.weekdaysParse(input);
                if (typeof input !== 'number') {
                    return null;
                }
            }
        }
        return input;
    }

    /************************************
        Relative Time
    ************************************/


    // helper function for moment.fn.from, moment.fn.fromNow, and moment.duration.fn.humanize
    function substituteTimeAgo(string, number, withoutSuffix, isFuture, lang) {
        return lang.relativeTime(number || 1, !!withoutSuffix, string, isFuture);
    }

    function relativeTime(milliseconds, withoutSuffix, lang) {
        var seconds = round(Math.abs(milliseconds) / 1000),
            minutes = round(seconds / 60),
            hours = round(minutes / 60),
            days = round(hours / 24),
            years = round(days / 365),
            args = seconds < relativeTimeThresholds.s  && ['s', seconds] ||
                minutes === 1 && ['m'] ||
                minutes < relativeTimeThresholds.m && ['mm', minutes] ||
                hours === 1 && ['h'] ||
                hours < relativeTimeThresholds.h && ['hh', hours] ||
                days === 1 && ['d'] ||
                days <= relativeTimeThresholds.dd && ['dd', days] ||
                days <= relativeTimeThresholds.dm && ['M'] ||
                days < relativeTimeThresholds.dy && ['MM', round(days / 30)] ||
                years === 1 && ['y'] || ['yy', years];
        args[2] = withoutSuffix;
        args[3] = milliseconds > 0;
        args[4] = lang;
        return substituteTimeAgo.apply({}, args);
    }


    /************************************
        Week of Year
    ************************************/


    // firstDayOfWeek       0 = sun, 6 = sat
    //                      the day of the week that starts the week
    //                      (usually sunday or monday)
    // firstDayOfWeekOfYear 0 = sun, 6 = sat
    //                      the first week is the week that contains the first
    //                      of this day of the week
    //                      (eg. ISO weeks use thursday (4))
    function weekOfYear(mom, firstDayOfWeek, firstDayOfWeekOfYear) {
        var end = firstDayOfWeekOfYear - firstDayOfWeek,
            daysToDayOfWeek = firstDayOfWeekOfYear - mom.day(),
            adjustedMoment;


        if (daysToDayOfWeek > end) {
            daysToDayOfWeek -= 7;
        }

        if (daysToDayOfWeek < end - 7) {
            daysToDayOfWeek += 7;
        }

        adjustedMoment = moment(mom).add('d', daysToDayOfWeek);
        return {
            week: Math.ceil(adjustedMoment.dayOfYear() / 7),
            year: adjustedMoment.year()
        };
    }

    //http://en.wikipedia.org/wiki/ISO_week_date#Calculating_a_date_given_the_year.2C_week_number_and_weekday
    function dayOfYearFromWeeks(year, week, weekday, firstDayOfWeekOfYear, firstDayOfWeek) {
        var d = makeUTCDate(year, 0, 1).getUTCDay(), daysToAdd, dayOfYear;

        d = d === 0 ? 7 : d;
        weekday = weekday != null ? weekday : firstDayOfWeek;
        daysToAdd = firstDayOfWeek - d + (d > firstDayOfWeekOfYear ? 7 : 0) - (d < firstDayOfWeek ? 7 : 0);
        dayOfYear = 7 * (week - 1) + (weekday - firstDayOfWeek) + daysToAdd + 1;

        return {
            year: dayOfYear > 0 ? year : year - 1,
            dayOfYear: dayOfYear > 0 ?  dayOfYear : daysInYear(year - 1) + dayOfYear
        };
    }

    /************************************
        Top Level Functions
    ************************************/

    function makeMoment(config) {
        var input = config._i,
            format = config._f;

        if (input === null || (format === undefined && input === '')) {
            return moment.invalid({nullInput: true});
        }

        if (typeof input === 'string') {
            config._i = input = getLangDefinition().preparse(input);
        }

        if (moment.isMoment(input)) {
            config = cloneMoment(input);

            config._d = new Date(+input._d);
        } else if (format) {
            if (isArray(format)) {
                makeDateFromStringAndArray(config);
            } else {
                makeDateFromStringAndFormat(config);
            }
        } else {
            makeDateFromInput(config);
        }

        return new Moment(config);
    }

    moment = function (input, format, lang, strict) {
        var c;

        if (typeof(lang) === "boolean") {
            strict = lang;
            lang = undefined;
        }
        // object construction must be done this way.
        // https://github.com/moment/moment/issues/1423
        c = {};
        c._isAMomentObject = true;
        c._i = input;
        c._f = format;
        c._l = lang;
        c._strict = strict;
        c._isUTC = false;
        c._pf = defaultParsingFlags();

        return makeMoment(c);
    };

    moment.suppressDeprecationWarnings = false;

    moment.createFromInputFallback = deprecate(
            "moment construction falls back to js Date. This is " +
            "discouraged and will be removed in upcoming major " +
            "release. Please refer to " +
            "https://github.com/moment/moment/issues/1407 for more info.",
            function (config) {
        config._d = new Date(config._i);
    });

    // Pick a moment m from moments so that m[fn](other) is true for all
    // other. This relies on the function fn to be transitive.
    //
    // moments should either be an array of moment objects or an array, whose
    // first element is an array of moment objects.
    function pickBy(fn, moments) {
        var res, i;
        if (moments.length === 1 && isArray(moments[0])) {
            moments = moments[0];
        }
        if (!moments.length) {
            return moment();
        }
        res = moments[0];
        for (i = 1; i < moments.length; ++i) {
            if (moments[i][fn](res)) {
                res = moments[i];
            }
        }
        return res;
    }

    moment.min = function () {
        var args = [].slice.call(arguments, 0);

        return pickBy('isBefore', args);
    };

    moment.max = function () {
        var args = [].slice.call(arguments, 0);

        return pickBy('isAfter', args);
    };

    // creating with utc
    moment.utc = function (input, format, lang, strict) {
        var c;

        if (typeof(lang) === "boolean") {
            strict = lang;
            lang = undefined;
        }
        // object construction must be done this way.
        // https://github.com/moment/moment/issues/1423
        c = {};
        c._isAMomentObject = true;
        c._useUTC = true;
        c._isUTC = true;
        c._l = lang;
        c._i = input;
        c._f = format;
        c._strict = strict;
        c._pf = defaultParsingFlags();

        return makeMoment(c).utc();
    };

    // creating with unix timestamp (in seconds)
    moment.unix = function (input) {
        return moment(input * 1000);
    };

    // duration
    moment.duration = function (input, key) {
        var duration = input,
            // matching against regexp is expensive, do it on demand
            match = null,
            sign,
            ret,
            parseIso;

        if (moment.isDuration(input)) {
            duration = {
                ms: input._milliseconds,
                d: input._days,
                M: input._months
            };
        } else if (typeof input === 'number') {
            duration = {};
            if (key) {
                duration[key] = input;
            } else {
                duration.milliseconds = input;
            }
        } else if (!!(match = aspNetTimeSpanJsonRegex.exec(input))) {
            sign = (match[1] === "-") ? -1 : 1;
            duration = {
                y: 0,
                d: toInt(match[DATE]) * sign,
                h: toInt(match[HOUR]) * sign,
                m: toInt(match[MINUTE]) * sign,
                s: toInt(match[SECOND]) * sign,
                ms: toInt(match[MILLISECOND]) * sign
            };
        } else if (!!(match = isoDurationRegex.exec(input))) {
            sign = (match[1] === "-") ? -1 : 1;
            parseIso = function (inp) {
                // We'd normally use ~~inp for this, but unfortunately it also
                // converts floats to ints.
                // inp may be undefined, so careful calling replace on it.
                var res = inp && parseFloat(inp.replace(',', '.'));
                // apply sign while we're at it
                return (isNaN(res) ? 0 : res) * sign;
            };
            duration = {
                y: parseIso(match[2]),
                M: parseIso(match[3]),
                d: parseIso(match[4]),
                h: parseIso(match[5]),
                m: parseIso(match[6]),
                s: parseIso(match[7]),
                w: parseIso(match[8])
            };
        }

        ret = new Duration(duration);

        if (moment.isDuration(input) && input.hasOwnProperty('_lang')) {
            ret._lang = input._lang;
        }

        return ret;
    };

    // version number
    moment.version = VERSION;

    // default format
    moment.defaultFormat = isoFormat;

    // constant that refers to the ISO standard
    moment.ISO_8601 = function () {};

    // Plugins that add properties should also add the key here (null value),
    // so we can properly clone ourselves.
    moment.momentProperties = momentProperties;

    // This function will be called whenever a moment is mutated.
    // It is intended to keep the offset in sync with the timezone.
    moment.updateOffset = function () {};

    // This function allows you to set a threshold for relative time strings
    moment.relativeTimeThreshold = function(threshold, limit) {
      if (relativeTimeThresholds[threshold] === undefined) {
        return false;
      }
      relativeTimeThresholds[threshold] = limit;
      return true;
    };

    // This function will load languages and then set the global language.  If
    // no arguments are passed in, it will simply return the current global
    // language key.
    moment.lang = function (key, values) {
        var r;
        if (!key) {
            return moment.fn._lang._abbr;
        }
        if (values) {
            loadLang(normalizeLanguage(key), values);
        } else if (values === null) {
            unloadLang(key);
            key = 'en';
        } else if (!languages[key]) {
            getLangDefinition(key);
        }
        r = moment.duration.fn._lang = moment.fn._lang = getLangDefinition(key);
        return r._abbr;
    };

    // returns language data
    moment.langData = function (key) {
        if (key && key._lang && key._lang._abbr) {
            key = key._lang._abbr;
        }
        return getLangDefinition(key);
    };

    // compare moment object
    moment.isMoment = function (obj) {
        return obj instanceof Moment ||
            (obj != null &&  obj.hasOwnProperty('_isAMomentObject'));
    };

    // for typechecking Duration objects
    moment.isDuration = function (obj) {
        return obj instanceof Duration;
    };

    for (i = lists.length - 1; i >= 0; --i) {
        makeList(lists[i]);
    }

    moment.normalizeUnits = function (units) {
        return normalizeUnits(units);
    };

    moment.invalid = function (flags) {
        var m = moment.utc(NaN);
        if (flags != null) {
            extend(m._pf, flags);
        }
        else {
            m._pf.userInvalidated = true;
        }

        return m;
    };

    moment.parseZone = function () {
        return moment.apply(null, arguments).parseZone();
    };

    moment.parseTwoDigitYear = function (input) {
        return toInt(input) + (toInt(input) > 68 ? 1900 : 2000);
    };

    /************************************
        Moment Prototype
    ************************************/


    extend(moment.fn = Moment.prototype, {

        clone : function () {
            return moment(this);
        },

        valueOf : function () {
            return +this._d + ((this._offset || 0) * 60000);
        },

        unix : function () {
            return Math.floor(+this / 1000);
        },

        toString : function () {
            return this.clone().lang('en').format("ddd MMM DD YYYY HH:mm:ss [GMT]ZZ");
        },

        toDate : function () {
            return this._offset ? new Date(+this) : this._d;
        },

        toISOString : function () {
            var m = moment(this).utc();
            if (0 < m.year() && m.year() <= 9999) {
                return formatMoment(m, 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]');
            } else {
                return formatMoment(m, 'YYYYYY-MM-DD[T]HH:mm:ss.SSS[Z]');
            }
        },

        toArray : function () {
            var m = this;
            return [
                m.year(),
                m.month(),
                m.date(),
                m.hours(),
                m.minutes(),
                m.seconds(),
                m.milliseconds()
            ];
        },

        isValid : function () {
            return isValid(this);
        },

        isDSTShifted : function () {

            if (this._a) {
                return this.isValid() && compareArrays(this._a, (this._isUTC ? moment.utc(this._a) : moment(this._a)).toArray()) > 0;
            }

            return false;
        },

        parsingFlags : function () {
            return extend({}, this._pf);
        },

        invalidAt: function () {
            return this._pf.overflow;
        },

        utc : function () {
            return this.zone(0);
        },

        local : function () {
            this.zone(0);
            this._isUTC = false;
            return this;
        },

        format : function (inputString) {
            var output = formatMoment(this, inputString || moment.defaultFormat);
            return this.lang().postformat(output);
        },

        add : function (input, val) {
            var dur;
            // switch args to support add('s', 1) and add(1, 's')
            if (typeof input === 'string' && typeof val === 'string') {
                dur = moment.duration(isNaN(+val) ? +input : +val, isNaN(+val) ? val : input);
            } else if (typeof input === 'string') {
                dur = moment.duration(+val, input);
            } else {
                dur = moment.duration(input, val);
            }
            addOrSubtractDurationFromMoment(this, dur, 1);
            return this;
        },

        subtract : function (input, val) {
            var dur;
            // switch args to support subtract('s', 1) and subtract(1, 's')
            if (typeof input === 'string' && typeof val === 'string') {
                dur = moment.duration(isNaN(+val) ? +input : +val, isNaN(+val) ? val : input);
            } else if (typeof input === 'string') {
                dur = moment.duration(+val, input);
            } else {
                dur = moment.duration(input, val);
            }
            addOrSubtractDurationFromMoment(this, dur, -1);
            return this;
        },

        diff : function (input, units, asFloat) {
            var that = makeAs(input, this),
                zoneDiff = (this.zone() - that.zone()) * 6e4,
                diff, output;

            units = normalizeUnits(units);

            if (units === 'year' || units === 'month') {
                // average number of days in the months in the given dates
                diff = (this.daysInMonth() + that.daysInMonth()) * 432e5; // 24 * 60 * 60 * 1000 / 2
                // difference in months
                output = ((this.year() - that.year()) * 12) + (this.month() - that.month());
                // adjust by taking difference in days, average number of days
                // and dst in the given months.
                output += ((this - moment(this).startOf('month')) -
                        (that - moment(that).startOf('month'))) / diff;
                // same as above but with zones, to negate all dst
                output -= ((this.zone() - moment(this).startOf('month').zone()) -
                        (that.zone() - moment(that).startOf('month').zone())) * 6e4 / diff;
                if (units === 'year') {
                    output = output / 12;
                }
            } else {
                diff = (this - that);
                output = units === 'second' ? diff / 1e3 : // 1000
                    units === 'minute' ? diff / 6e4 : // 1000 * 60
                    units === 'hour' ? diff / 36e5 : // 1000 * 60 * 60
                    units === 'day' ? (diff - zoneDiff) / 864e5 : // 1000 * 60 * 60 * 24, negate dst
                    units === 'week' ? (diff - zoneDiff) / 6048e5 : // 1000 * 60 * 60 * 24 * 7, negate dst
                    diff;
            }
            return asFloat ? output : absRound(output);
        },

        from : function (time, withoutSuffix) {
            return moment.duration(this.diff(time)).lang(this.lang()._abbr).humanize(!withoutSuffix);
        },

        fromNow : function (withoutSuffix) {
            return this.from(moment(), withoutSuffix);
        },

        calendar : function (time) {
            // We want to compare the start of today, vs this.
            // Getting start-of-today depends on whether we're zone'd or not.
            var now = time || moment(),
                sod = makeAs(now, this).startOf('day'),
                diff = this.diff(sod, 'days', true),
                format = diff < -6 ? 'sameElse' :
                    diff < -1 ? 'lastWeek' :
                    diff < 0 ? 'lastDay' :
                    diff < 1 ? 'sameDay' :
                    diff < 2 ? 'nextDay' :
                    diff < 7 ? 'nextWeek' : 'sameElse';
            return this.format(this.lang().calendar(format, this));
        },

        isLeapYear : function () {
            return isLeapYear(this.year());
        },

        isDST : function () {
            return (this.zone() < this.clone().month(0).zone() ||
                this.zone() < this.clone().month(5).zone());
        },

        day : function (input) {
            var day = this._isUTC ? this._d.getUTCDay() : this._d.getDay();
            if (input != null) {
                input = parseWeekday(input, this.lang());
                return this.add({ d : input - day });
            } else {
                return day;
            }
        },

        month : makeAccessor('Month', true),

        startOf: function (units) {
            units = normalizeUnits(units);
            // the following switch intentionally omits break keywords
            // to utilize falling through the cases.
            switch (units) {
            case 'year':
                this.month(0);
                /* falls through */
            case 'quarter':
            case 'month':
                this.date(1);
                /* falls through */
            case 'week':
            case 'isoWeek':
            case 'day':
                this.hours(0);
                /* falls through */
            case 'hour':
                this.minutes(0);
                /* falls through */
            case 'minute':
                this.seconds(0);
                /* falls through */
            case 'second':
                this.milliseconds(0);
                /* falls through */
            }

            // weeks are a special case
            if (units === 'week') {
                this.weekday(0);
            } else if (units === 'isoWeek') {
                this.isoWeekday(1);
            }

            // quarters are also special
            if (units === 'quarter') {
                this.month(Math.floor(this.month() / 3) * 3);
            }

            return this;
        },

        endOf: function (units) {
            units = normalizeUnits(units);
            return this.startOf(units).add((units === 'isoWeek' ? 'week' : units), 1).subtract('ms', 1);
        },

        isAfter: function (input, units) {
            units = typeof units !== 'undefined' ? units : 'millisecond';
            return +this.clone().startOf(units) > +moment(input).startOf(units);
        },

        isBefore: function (input, units) {
            units = typeof units !== 'undefined' ? units : 'millisecond';
            return +this.clone().startOf(units) < +moment(input).startOf(units);
        },

        isSame: function (input, units) {
            units = units || 'ms';
            return +this.clone().startOf(units) === +makeAs(input, this).startOf(units);
        },

        min: deprecate(
                 "moment().min is deprecated, use moment.min instead. https://github.com/moment/moment/issues/1548",
                 function (other) {
                     other = moment.apply(null, arguments);
                     return other < this ? this : other;
                 }
         ),

        max: deprecate(
                "moment().max is deprecated, use moment.max instead. https://github.com/moment/moment/issues/1548",
                function (other) {
                    other = moment.apply(null, arguments);
                    return other > this ? this : other;
                }
        ),

        // keepTime = true means only change the timezone, without affecting
        // the local hour. So 5:31:26 +0300 --[zone(2, true)]--> 5:31:26 +0200
        // It is possible that 5:31:26 doesn't exist int zone +0200, so we
        // adjust the time as needed, to be valid.
        //
        // Keeping the time actually adds/subtracts (one hour)
        // from the actual represented time. That is why we call updateOffset
        // a second time. In case it wants us to change the offset again
        // _changeInProgress == true case, then we have to adjust, because
        // there is no such time in the given timezone.
        zone : function (input, keepTime) {
            var offset = this._offset || 0;
            if (input != null) {
                if (typeof input === "string") {
                    input = timezoneMinutesFromString(input);
                }
                if (Math.abs(input) < 16) {
                    input = input * 60;
                }
                this._offset = input;
                this._isUTC = true;
                if (offset !== input) {
                    if (!keepTime || this._changeInProgress) {
                        addOrSubtractDurationFromMoment(this,
                                moment.duration(offset - input, 'm'), 1, false);
                    } else if (!this._changeInProgress) {
                        this._changeInProgress = true;
                        moment.updateOffset(this, true);
                        this._changeInProgress = null;
                    }
                }
            } else {
                return this._isUTC ? offset : this._d.getTimezoneOffset();
            }
            return this;
        },

        zoneAbbr : function () {
            return this._isUTC ? "UTC" : "";
        },

        zoneName : function () {
            return this._isUTC ? "Coordinated Universal Time" : "";
        },

        parseZone : function () {
            if (this._tzm) {
                this.zone(this._tzm);
            } else if (typeof this._i === 'string') {
                this.zone(this._i);
            }
            return this;
        },

        hasAlignedHourOffset : function (input) {
            if (!input) {
                input = 0;
            }
            else {
                input = moment(input).zone();
            }

            return (this.zone() - input) % 60 === 0;
        },

        daysInMonth : function () {
            return daysInMonth(this.year(), this.month());
        },

        dayOfYear : function (input) {
            var dayOfYear = round((moment(this).startOf('day') - moment(this).startOf('year')) / 864e5) + 1;
            return input == null ? dayOfYear : this.add("d", (input - dayOfYear));
        },

        quarter : function (input) {
            return input == null ? Math.ceil((this.month() + 1) / 3) : this.month((input - 1) * 3 + this.month() % 3);
        },

        weekYear : function (input) {
            var year = weekOfYear(this, this.lang()._week.dow, this.lang()._week.doy).year;
            return input == null ? year : this.add("y", (input - year));
        },

        isoWeekYear : function (input) {
            var year = weekOfYear(this, 1, 4).year;
            return input == null ? year : this.add("y", (input - year));
        },

        week : function (input) {
            var week = this.lang().week(this);
            return input == null ? week : this.add("d", (input - week) * 7);
        },

        isoWeek : function (input) {
            var week = weekOfYear(this, 1, 4).week;
            return input == null ? week : this.add("d", (input - week) * 7);
        },

        weekday : function (input) {
            var weekday = (this.day() + 7 - this.lang()._week.dow) % 7;
            return input == null ? weekday : this.add("d", input - weekday);
        },

        isoWeekday : function (input) {
            // behaves the same as moment#day except
            // as a getter, returns 7 instead of 0 (1-7 range instead of 0-6)
            // as a setter, sunday should belong to the previous week.
            return input == null ? this.day() || 7 : this.day(this.day() % 7 ? input : input - 7);
        },

        isoWeeksInYear : function () {
            return weeksInYear(this.year(), 1, 4);
        },

        weeksInYear : function () {
            var weekInfo = this._lang._week;
            return weeksInYear(this.year(), weekInfo.dow, weekInfo.doy);
        },

        get : function (units) {
            units = normalizeUnits(units);
            return this[units]();
        },

        set : function (units, value) {
            units = normalizeUnits(units);
            if (typeof this[units] === 'function') {
                this[units](value);
            }
            return this;
        },

        // If passed a language key, it will set the language for this
        // instance.  Otherwise, it will return the language configuration
        // variables for this instance.
        lang : function (key) {
            if (key === undefined) {
                return this._lang;
            } else {
                this._lang = getLangDefinition(key);
                return this;
            }
        }
    });

    function rawMonthSetter(mom, value) {
        var dayOfMonth;

        // TODO: Move this out of here!
        if (typeof value === 'string') {
            value = mom.lang().monthsParse(value);
            // TODO: Another silent failure?
            if (typeof value !== 'number') {
                return mom;
            }
        }

        dayOfMonth = Math.min(mom.date(),
                daysInMonth(mom.year(), value));
        mom._d['set' + (mom._isUTC ? 'UTC' : '') + 'Month'](value, dayOfMonth);
        return mom;
    }

    function rawGetter(mom, unit) {
        return mom._d['get' + (mom._isUTC ? 'UTC' : '') + unit]();
    }

    function rawSetter(mom, unit, value) {
        if (unit === 'Month') {
            return rawMonthSetter(mom, value);
        } else {
            return mom._d['set' + (mom._isUTC ? 'UTC' : '') + unit](value);
        }
    }

    function makeAccessor(unit, keepTime) {
        return function (value) {
            if (value != null) {
                rawSetter(this, unit, value);
                moment.updateOffset(this, keepTime);
                return this;
            } else {
                return rawGetter(this, unit);
            }
        };
    }

    moment.fn.millisecond = moment.fn.milliseconds = makeAccessor('Milliseconds', false);
    moment.fn.second = moment.fn.seconds = makeAccessor('Seconds', false);
    moment.fn.minute = moment.fn.minutes = makeAccessor('Minutes', false);
    // Setting the hour should keep the time, because the user explicitly
    // specified which hour he wants. So trying to maintain the same hour (in
    // a new timezone) makes sense. Adding/subtracting hours does not follow
    // this rule.
    moment.fn.hour = moment.fn.hours = makeAccessor('Hours', true);
    // moment.fn.month is defined separately
    moment.fn.date = makeAccessor('Date', true);
    moment.fn.dates = deprecate("dates accessor is deprecated. Use date instead.", makeAccessor('Date', true));
    moment.fn.year = makeAccessor('FullYear', true);
    moment.fn.years = deprecate("years accessor is deprecated. Use year instead.", makeAccessor('FullYear', true));

    // add plural methods
    moment.fn.days = moment.fn.day;
    moment.fn.months = moment.fn.month;
    moment.fn.weeks = moment.fn.week;
    moment.fn.isoWeeks = moment.fn.isoWeek;
    moment.fn.quarters = moment.fn.quarter;

    // add aliased format methods
    moment.fn.toJSON = moment.fn.toISOString;

    /************************************
        Duration Prototype
    ************************************/


    extend(moment.duration.fn = Duration.prototype, {

        _bubble : function () {
            var milliseconds = this._milliseconds,
                days = this._days,
                months = this._months,
                data = this._data,
                seconds, minutes, hours, years;

            // The following code bubbles up values, see the tests for
            // examples of what that means.
            data.milliseconds = milliseconds % 1000;

            seconds = absRound(milliseconds / 1000);
            data.seconds = seconds % 60;

            minutes = absRound(seconds / 60);
            data.minutes = minutes % 60;

            hours = absRound(minutes / 60);
            data.hours = hours % 24;

            days += absRound(hours / 24);
            data.days = days % 30;

            months += absRound(days / 30);
            data.months = months % 12;

            years = absRound(months / 12);
            data.years = years;
        },

        weeks : function () {
            return absRound(this.days() / 7);
        },

        valueOf : function () {
            return this._milliseconds +
              this._days * 864e5 +
              (this._months % 12) * 2592e6 +
              toInt(this._months / 12) * 31536e6;
        },

        humanize : function (withSuffix) {
            var difference = +this,
                output = relativeTime(difference, !withSuffix, this.lang());

            if (withSuffix) {
                output = this.lang().pastFuture(difference, output);
            }

            return this.lang().postformat(output);
        },

        add : function (input, val) {
            // supports only 2.0-style add(1, 's') or add(moment)
            var dur = moment.duration(input, val);

            this._milliseconds += dur._milliseconds;
            this._days += dur._days;
            this._months += dur._months;

            this._bubble();

            return this;
        },

        subtract : function (input, val) {
            var dur = moment.duration(input, val);

            this._milliseconds -= dur._milliseconds;
            this._days -= dur._days;
            this._months -= dur._months;

            this._bubble();

            return this;
        },

        get : function (units) {
            units = normalizeUnits(units);
            return this[units.toLowerCase() + 's']();
        },

        as : function (units) {
            units = normalizeUnits(units);
            return this['as' + units.charAt(0).toUpperCase() + units.slice(1) + 's']();
        },

        lang : moment.fn.lang,

        toIsoString : function () {
            // inspired by https://github.com/dordille/moment-isoduration/blob/master/moment.isoduration.js
            var years = Math.abs(this.years()),
                months = Math.abs(this.months()),
                days = Math.abs(this.days()),
                hours = Math.abs(this.hours()),
                minutes = Math.abs(this.minutes()),
                seconds = Math.abs(this.seconds() + this.milliseconds() / 1000);

            if (!this.asSeconds()) {
                // this is the same as C#'s (Noda) and python (isodate)...
                // but not other JS (goog.date)
                return 'P0D';
            }

            return (this.asSeconds() < 0 ? '-' : '') +
                'P' +
                (years ? years + 'Y' : '') +
                (months ? months + 'M' : '') +
                (days ? days + 'D' : '') +
                ((hours || minutes || seconds) ? 'T' : '') +
                (hours ? hours + 'H' : '') +
                (minutes ? minutes + 'M' : '') +
                (seconds ? seconds + 'S' : '');
        }
    });

    function makeDurationGetter(name) {
        moment.duration.fn[name] = function () {
            return this._data[name];
        };
    }

    function makeDurationAsGetter(name, factor) {
        moment.duration.fn['as' + name] = function () {
            return +this / factor;
        };
    }

    for (i in unitMillisecondFactors) {
        if (unitMillisecondFactors.hasOwnProperty(i)) {
            makeDurationAsGetter(i, unitMillisecondFactors[i]);
            makeDurationGetter(i.toLowerCase());
        }
    }

    makeDurationAsGetter('Weeks', 6048e5);
    moment.duration.fn.asMonths = function () {
        return (+this - this.years() * 31536e6) / 2592e6 + this.years() * 12;
    };


    /************************************
        Default Lang
    ************************************/


    // Set default language, other languages will inherit from English.
    moment.lang('en', {
        ordinal : function (number) {
            var b = number % 10,
                output = (toInt(number % 100 / 10) === 1) ? 'th' :
                (b === 1) ? 'st' :
                (b === 2) ? 'nd' :
                (b === 3) ? 'rd' : 'th';
            return number + output;
        }
    });

    /* EMBED_LANGUAGES */

    /************************************
        Exposing Moment
    ************************************/

    function makeGlobal(shouldDeprecate) {
        /*global ender:false */
        if (typeof ender !== 'undefined') {
            return;
        }
        oldGlobalMoment = globalScope.moment;
        if (shouldDeprecate) {
            globalScope.moment = deprecate(
                    "Accessing Moment through the global scope is " +
                    "deprecated, and will be removed in an upcoming " +
                    "release.",
                    moment);
        } else {
            globalScope.moment = moment;
        }
    }

    // CommonJS module is defined
    if (hasModule) {
        module.exports = moment;
    } else if (typeof define === "function" && define.amd) {
        define("moment", function (require, exports, module) {
            if (module.config && module.config() && module.config().noGlobal === true) {
                // release the global variable
                globalScope.moment = oldGlobalMoment;
            }

            return moment;
        });
        makeGlobal(true);
    } else {
        makeGlobal();
    }
}).call(this);

/*
	Redactor v9.2.5
	Updated: Jun 5, 2014

	http://imperavi.com/redactor/

	Copyright (c) 2009-2014, Imperavi LLC.
	License: http://imperavi.com/redactor/license/

	Usage: $('#content').redactor();
*/
(function($)
{
	var uuid = 0;

	"use strict";

	var Range = function(range)
	{
		this[0] = range.startOffset;
		this[1] = range.endOffset;

		this.range = range;

		return this;
	};

	Range.prototype.equals = function()
	{
		return this[0] === this[1];
	};

	var reUrlYoutube = /https?:\/\/(?:[0-9A-Z-]+\.)?(?:youtu\.be\/|youtube\.com\S*[^\w\-\s])([\w\-]{11})(?=[^\w\-]|$)(?![?=&+%\w.-]*(?:['"][^<>]*>|<\/a>))[?=&+%\w.-]*/ig;
	var reUrlVimeo = /https?:\/\/(www\.)?vimeo.com\/(\d+)($|\/)/;

	// Plugin
	$.fn.redactor = function(options)
	{
		var val = [];
		var args = Array.prototype.slice.call(arguments, 1);

		if (typeof options === 'string')
		{
			this.each(function()
			{
				var instance = $.data(this, 'redactor');
				if (typeof instance !== 'undefined' && $.isFunction(instance[options]))
				{
					var methodVal = instance[options].apply(instance, args);
					if (methodVal !== undefined && methodVal !== instance) val.push(methodVal);
				}
				else return $.error('No such method "' + options + '" for Redactor');
			});
		}
		else
		{
			this.each(function()
			{
				if (!$.data(this, 'redactor')) $.data(this, 'redactor', Redactor(this, options));
			});
		}

		if (val.length === 0) return this;
		else if (val.length === 1) return val[0];
		else return val;

	};

	// Initialization
	function Redactor(el, options)
	{
		return new Redactor.prototype.init(el, options);
	}

	$.Redactor = Redactor;
	$.Redactor.VERSION = '9.2.5';
	$.Redactor.opts = {

			// settings
			rangy: false,

			iframe: false,
			fullpage: false,
			css: false, // url

			lang: 'en',
			direction: 'ltr', // ltr or rtl

			placeholder: false,

			typewriter: false,
			wym: false,
			mobile: true,
			cleanup: true,
			tidyHtml: true,
			pastePlainText: false,
			removeEmptyTags: true,
			cleanSpaces: true,
			cleanFontTag: true,
			templateVars: false,
			xhtml: false,

			visual: true,
			focus: false,
			tabindex: false,
			autoresize: true,
			minHeight: false,
			maxHeight: false,
			shortcuts: {
				'ctrl+m, meta+m': "this.execCommand('removeFormat', false)",
				'ctrl+b, meta+b': "this.execCommand('bold', false)",
				'ctrl+i, meta+i': "this.execCommand('italic', false)",
				'ctrl+h, meta+h': "this.execCommand('superscript', false)",
				'ctrl+l, meta+l': "this.execCommand('subscript', false)",
				'ctrl+k, meta+k': "this.linkShow()",
				'ctrl+shift+7': "this.execCommand('insertorderedlist', false)",
				'ctrl+shift+8': "this.execCommand('insertunorderedlist', false)"
			},
			shortcutsAdd: false,

			autosave: false, // false or url
			autosaveInterval: 60, // seconds

			plugins: false, // array

			//linkAnchor: true,
			//linkEmail: true,
			linkProtocol: 'http://',
			linkNofollow: false,
			linkSize: 50,
			predefinedLinks: false, // json url (ex. /some-url.json ) or false

			imageFloatMargin: '10px',
			imageGetJson: false, // json url (ex. /some-images.json ) or false

			dragUpload: true, // false
			imageTabLink: true,
			imageUpload: false, // url
			imageUploadParam: 'file', // input name
			imageResizable: true,

			fileUpload: false, // url
			fileUploadParam: 'file', // input name
			clipboardUpload: true, // or false
			clipboardUploadUrl: false, // url

			dnbImageTypes: ['image/png', 'image/jpeg', 'image/gif'], // or false

			s3: false,
			uploadFields: false,

			observeImages: true,
			observeLinks: true,

			modalOverlay: true,

			tabSpaces: false, // true or number of spaces
			tabFocus: true,

			air: false,
			airButtons: ['formatting', 'bold', 'italic', 'deleted', 'unorderedlist', 'orderedlist', 'outdent', 'indent'],

			toolbar: true,
			toolbarFixed: false,
			toolbarFixedTarget: document,
			toolbarFixedTopOffset: 0, // pixels
			toolbarFixedBox: false,
			toolbarExternal: false, // ID selector
			toolbarOverflow: false,
			buttonSource: true,

			buttons: ['html', 'formatting', 'bold', 'italic', 'deleted', 'unorderedlist', 'orderedlist',
					  'outdent', 'indent', 'image', 'video', 'file', 'table', 'link', 'alignment', '|',
					  'horizontalrule'], // 'underline', 'alignleft', 'aligncenter', 'alignright', 'justify'
			buttonsHideOnMobile: [],

			activeButtons: ['deleted', 'italic', 'bold', 'underline', 'unorderedlist', 'orderedlist',
							'alignleft', 'aligncenter', 'alignright', 'justify', 'table'],
			activeButtonsStates: {
				b: 'bold',
				strong: 'bold',
				i: 'italic',
				em: 'italic',
				del: 'deleted',
				strike: 'deleted',
				ul: 'unorderedlist',
				ol: 'orderedlist',
				u: 'underline',
				tr: 'table',
				td: 'table',
				table: 'table'
			},

			formattingTags: ['p', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],

			linebreaks: false,
			paragraphy: true,
			convertDivs: true,
			convertLinks: true,
			convertImageLinks: false,
			convertVideoLinks: false,
			formattingPre: false,
			phpTags: false,

			allowedTags: false,
			deniedTags: ['html', 'head', 'link', 'body', 'meta', 'script', 'style', 'applet'],

			boldTag: 'strong',
			italicTag: 'em',

			// private
			indentValue: 20,
			buffer: [],
			rebuffer: [],
			textareamode: false,
			emptyHtml: '<p>&#x200b;</p>',
			invisibleSpace: '&#x200b;',
			rBlockTest: /^(P|H[1-6]|LI|ADDRESS|SECTION|HEADER|FOOTER|ASIDE|ARTICLE)$/i,
			alignmentTags: ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DD', 'DL', 'DT', 'DIV', 'TD',
								'BLOCKQUOTE', 'OUTPUT', 'FIGCAPTION', 'ADDRESS', 'SECTION',
								'HEADER', 'FOOTER', 'ASIDE', 'ARTICLE'],
			ownLine: ['area', 'body', 'head', 'hr', 'i?frame', 'link', 'meta', 'noscript', 'style', 'script', 'table', 'tbody', 'thead', 'tfoot'],
			contOwnLine: ['li', 'dt', 'dt', 'h[1-6]', 'option', 'script'],
			newLevel: ['blockquote', 'div', 'dl', 'fieldset', 'form', 'frameset', 'map', 'ol', 'p', 'pre', 'select', 'td', 'th', 'tr', 'ul'],
			blockLevelElements: ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DD', 'DL', 'DT', 'DIV', 'LI',
								'BLOCKQUOTE', 'OUTPUT', 'FIGCAPTION', 'PRE', 'ADDRESS', 'SECTION',
								'HEADER', 'FOOTER', 'ASIDE', 'ARTICLE', 'TD'],


			// lang
			langs: {
				en: {
					html: 'HTML',
					video: 'Insert Video',
					image: 'Insert Image',
					table: 'Table',
					link: 'Link',
					link_insert: 'Insert link',
					link_edit: 'Edit link',
					unlink: 'Unlink',
					formatting: 'Formatting',
					paragraph: 'Normal text',
					quote: 'Quote',
					code: 'Code',
					header1: 'Header 1',
					header2: 'Header 2',
					header3: 'Header 3',
					header4: 'Header 4',
					header5: 'Header 5',
					bold: 'Bold',
					italic: 'Italic',
					fontcolor: 'Font Color',
					backcolor: 'Back Color',
					unorderedlist: 'Unordered List',
					orderedlist: 'Ordered List',
					outdent: 'Outdent',
					indent: 'Indent',
					cancel: 'Cancel',
					insert: 'Insert',
					save: 'Save',
					_delete: 'Delete',
					insert_table: 'Insert Table',
					insert_row_above: 'Add Row Above',
					insert_row_below: 'Add Row Below',
					insert_column_left: 'Add Column Left',
					insert_column_right: 'Add Column Right',
					delete_column: 'Delete Column',
					delete_row: 'Delete Row',
					delete_table: 'Delete Table',
					rows: 'Rows',
					columns: 'Columns',
					add_head: 'Add Head',
					delete_head: 'Delete Head',
					title: 'Title',
					image_position: 'Position',
					none: 'None',
					left: 'Left',
					right: 'Right',
					center: 'Center',
					image_web_link: 'Image Web Link',
					text: 'Text',
					mailto: 'Email',
					web: 'URL',
					video_html_code: 'Video Embed Code',
					file: 'Insert File',
					upload: 'Upload',
					download: 'Download',
					choose: 'Choose',
					or_choose: 'Or choose',
					drop_file_here: 'Drop file here',
					align_left: 'Align text to the left',
					align_center: 'Center text',
					align_right: 'Align text to the right',
					align_justify: 'Justify text',
					horizontalrule: 'Insert Horizontal Rule',
					deleted: 'Deleted',
					anchor: 'Anchor',
					link_new_tab: 'Open link in new tab',
					underline: 'Underline',
					alignment: 'Alignment',
					filename: 'Name (optional)',
					edit: 'Edit'
				}
			}
	};

	// Functionality
	Redactor.fn = $.Redactor.prototype = {

		keyCode: {
			BACKSPACE: 8,
			DELETE: 46,
			DOWN: 40,
			ENTER: 13,
			ESC: 27,
			TAB: 9,
			CTRL: 17,
			META: 91,
			LEFT: 37,
			LEFT_WIN: 91
		},

		// Initialization
		init: function(el, options)
		{
			this.rtePaste = false;
			this.$element = this.$source = $(el);
			this.uuid = uuid++;

			// clonning options
			var opts = $.extend(true, {}, $.Redactor.opts);

			// current settings
			this.opts = $.extend(
				{},
				opts,
				this.$element.data(),
				options
			);

			this.start = true;
			this.dropdowns = [];

			// get sizes
			this.sourceHeight = this.$source.css('height');
			this.sourceWidth = this.$source.css('width');

			// dependency of the editor modes
			if (this.opts.fullpage) this.opts.iframe = true;
			if (this.opts.linebreaks) this.opts.paragraphy = false;
			if (this.opts.paragraphy) this.opts.linebreaks = false;
			if (this.opts.toolbarFixedBox) this.opts.toolbarFixed = true;

			// the alias for iframe mode
			this.document = document;
			this.window = window;

			// selection saved
			this.savedSel = false;

			// clean setup
			this.cleanlineBefore = new RegExp('^<(/?' + this.opts.ownLine.join('|/?' ) + '|' + this.opts.contOwnLine.join('|') + ')[ >]');
			this.cleanlineAfter = new RegExp('^<(br|/?' + this.opts.ownLine.join('|/?' ) + '|/' + this.opts.contOwnLine.join('|/') + ')[ >]');
			this.cleannewLevel = new RegExp('^</?(' + this.opts.newLevel.join('|' ) + ')[ >]');

			// block level
			this.rTestBlock = new RegExp('^(' + this.opts.blockLevelElements.join('|' ) + ')$', 'i');

			// setup formatting permissions
			if (this.opts.linebreaks === false)
			{
				if (this.opts.allowedTags !== false)
				{
					var arrSearch = ['strong', 'em', 'del'];
					var arrAdd = ['b', 'i', 'strike'];

					if ($.inArray('p', this.opts.allowedTags) === '-1') this.opts.allowedTags.push('p');

					for (i in arrSearch)
					{
						if ($.inArray(arrSearch[i], this.opts.allowedTags) != '-1') this.opts.allowedTags.push(arrAdd[i]);
					}
				}

				if (this.opts.deniedTags !== false)
				{
					var pos = $.inArray('p', this.opts.deniedTags);
					if (pos !== '-1') this.opts.deniedTags.splice(pos, pos);
				}
			}

			// ie & opera
			if (this.browser('msie') || this.browser('opera'))
			{
				this.opts.buttons = this.removeFromArrayByValue(this.opts.buttons, 'horizontalrule');
			}

			// load lang
			this.opts.curLang = this.opts.langs[this.opts.lang];

			// extend shortcuts
			$.extend(this.opts.shortcuts, this.opts.shortcutsAdd);

			// init placeholder
			this.placeholderInit();

			// Build
			this.buildStart();

		},
		toolbarInit: function(lang)
		{
			return {
				html:
				{
					title: lang.html,
					func: 'toggle'
				},
				formatting:
				{
					title: lang.formatting,
					func: 'show',
					dropdown:
					{
						p:
						{
							title: lang.paragraph,
							func: 'formatBlocks'
						},
						blockquote:
						{
							title: lang.quote,
							func: 'formatQuote',
							className: 'redactor_format_blockquote'
						},
						pre:
						{
							title: lang.code,
							func: 'formatBlocks',
							className: 'redactor_format_pre'
						},
						h1:
						{
							title: lang.header1,
							func: 'formatBlocks',
							className: 'redactor_format_h1'
						},
						h2:
						{
							title: lang.header2,
							func: 'formatBlocks',
							className: 'redactor_format_h2'
						},
						h3:
						{
							title: lang.header3,
							func: 'formatBlocks',
							className: 'redactor_format_h3'
						},
						h4:
						{
							title: lang.header4,
							func: 'formatBlocks',
							className: 'redactor_format_h4'
						},
						h5:
						{
							title: lang.header5,
							func: 'formatBlocks',
							className: 'redactor_format_h5'
						}
					}
				},
				bold:
				{
					title: lang.bold,
					exec: 'bold'
				},
				italic:
				{
					title: lang.italic,
					exec: 'italic'
				},
				deleted:
				{
					title: lang.deleted,
					exec: 'strikethrough'
				},
				underline:
				{
					title: lang.underline,
					exec: 'underline'
				},
				unorderedlist:
				{
					title: '&bull; ' + lang.unorderedlist,
					exec: 'insertunorderedlist'
				},
				orderedlist:
				{
					title: '1. ' + lang.orderedlist,
					exec: 'insertorderedlist'
				},
				outdent:
				{
					title: '< ' + lang.outdent,
					func: 'indentingOutdent'
				},
				indent:
				{
					title: '> ' + lang.indent,
					func: 'indentingIndent'
				},
				image:
				{
					title: lang.image,
					func: 'imageShow'
				},
				video:
				{
					title: lang.video,
					func: 'videoShow'
				},
				file:
				{
					title: lang.file,
					func: 'fileShow'
				},
				table:
				{
					title: lang.table,
					func: 'show',
					dropdown:
					{
						insert_table:
						{
							title: lang.insert_table,
							func: 'tableShow'
						},
						separator_drop1:
						{
							name: 'separator'
						},
						insert_row_above:
						{
							title: lang.insert_row_above,
							func: 'tableAddRowAbove'
						},
						insert_row_below:
						{
							title: lang.insert_row_below,
							func: 'tableAddRowBelow'
						},
						insert_column_left:
						{
							title: lang.insert_column_left,
							func: 'tableAddColumnLeft'
						},
						insert_column_right:
						{
							title: lang.insert_column_right,
							func: 'tableAddColumnRight'
						},
						separator_drop2:
						{
							name: 'separator'
						},
						add_head:
						{
							title: lang.add_head,
							func: 'tableAddHead'
						},
						delete_head:
						{
							title: lang.delete_head,
							func: 'tableDeleteHead'
						},
						separator_drop3:
						{
							name: 'separator'
						},
						delete_column:
						{
							title: lang.delete_column,
							func: 'tableDeleteColumn'
						},
						delete_row:
						{
							title: lang.delete_row,
							func: 'tableDeleteRow'
						},
						delete_table:
						{
							title: lang.delete_table,
							func: 'tableDeleteTable'
						}
					}
				},
				link: {
					title: lang.link,
					func: 'show',
					dropdown:
					{
						link:
						{
							title: lang.link_insert,
							func: 'linkShow'
						},
						unlink:
						{
							title: lang.unlink,
							exec: 'unlink'
						}
					}
				},
				alignment:
				{
					title: lang.alignment,
					func: 'show',
					dropdown:
					{
						alignleft:
						{
							title: lang.align_left,
							func: 'alignmentLeft'
						},
						aligncenter:
						{
							title: lang.align_center,
							func: 'alignmentCenter'
						},
						alignright:
						{
							title: lang.align_right,
							func: 'alignmentRight'
						},
						justify:
						{
							title: lang.align_justify,
							func: 'alignmentJustify'
						}
					}
				},
				alignleft:
				{
					title: lang.align_left,
					func: 'alignmentLeft'
				},
				aligncenter:
				{
					title: lang.align_center,
					func: 'alignmentCenter'
				},
				alignright:
				{
					title: lang.align_right,
					func: 'alignmentRight'
				},
				alignjustify:
				{
					title: lang.align_justify,
					func: 'alignmentJustify'
				},
				horizontalrule:
				{
					exec: 'inserthorizontalrule',
					title: lang.horizontalrule
				}

			}
		},

		// CALLBACKS
		callback: function(type, event, data)
		{
			var callback = this.opts[ type + 'Callback' ];
			if ($.isFunction(callback))
			{
				if (event === false) return callback.call(this, data);
				else return callback.call(this, event, data);
			}
			else return data;
		},


		// DESTROY
		destroy: function()
		{
			clearInterval(this.autosaveInterval);

			$(window).off('.redactor');
			this.$source.off('redactor-textarea');
			this.$element.off('.redactor').removeData('redactor');

			var html = this.get();

			if (this.opts.textareamode)
			{
				this.$box.after(this.$source);
				this.$box.remove();
				this.$source.val(html).show();
			}
			else
			{
				var $elem = this.$editor;
				if (this.opts.iframe) $elem = this.$element;

				this.$box.after($elem);
				this.$box.remove();

				$elem.removeClass('redactor_editor').removeClass('redactor_editor_wym').removeAttr('contenteditable').html(html).show();
			}

			if (this.opts.toolbarExternal)
			{
				$(this.opts.toolbarExternal).html('');
			}

			if (this.opts.air)
			{
				$('#redactor_air_' + this.uuid).remove();
			}
		},

		// API GET
		getObject: function()
		{
			return $.extend({}, this);
		},
		getEditor: function()
		{
			return this.$editor;
		},
		getBox: function()
		{
			return this.$box;
		},
		getIframe: function()
		{
			return (this.opts.iframe) ? this.$frame : false;
		},
		getToolbar: function()
		{
			return (this.$toolbar) ? this.$toolbar : false;
		},

		// CODE GET & SET
		get: function()
		{
			return this.$source.val();
		},
		getCodeIframe: function()
		{
			this.$editor.removeAttr('contenteditable').removeAttr('dir');
			var html = this.outerHtml(this.$frame.contents().children());
			this.$editor.attr({ 'contenteditable': true, 'dir': this.opts.direction });

			return html;
		},
		set: function(html, strip, placeholderRemove)
		{
			html = html.toString();
			html = html.replace(/\$/g, '&#36;');

			if (this.opts.fullpage) this.setCodeIframe(html);
			else this.setEditor(html, strip);

			if (html == '') placeholderRemove = false;
			if (placeholderRemove !== false) this.placeholderRemoveFromEditor();
		},
		setEditor: function(html, strip)
		{

			if (strip !== false)
			{
				html = this.cleanSavePreCode(html);

				html = this.cleanStripTags(html);
				html = this.cleanConvertProtected(html);
				html = this.cleanConvertInlineTags(html, true);

				if (this.opts.linebreaks === false)	html = this.cleanConverters(html);
				else html = html.replace(/<p(.*?)>([\w\W]*?)<\/p>/gi, '$2<br>');
			}

			// $ fix
			html = html.replace(/&amp;#36;/g, '$');

			html = this.cleanEmpty(html);

			this.$editor.html(html);

			// set no editable
			this.setNonEditable();
			this.setSpansVerified();

			this.sync();
		},
		setCodeIframe: function(html)
		{
			var doc = this.iframePage();
			this.$frame[0].src = "about:blank";

			html = this.cleanConvertProtected(html);
			html = this.cleanConvertInlineTags(html);
			html = this.cleanRemoveSpaces(html);

			doc.open();
			doc.write(html);
			doc.close();

			// redefine editor for fullpage mode
			if (this.opts.fullpage)
			{
				this.$editor = this.$frame.contents().find('body').attr({ 'contenteditable': true, 'dir': this.opts.direction });
			}

			// set no editable
			this.setNonEditable();
			this.setSpansVerified();
			this.sync();

		},
		setFullpageOnInit: function(html)
		{
			this.fullpageDoctype = html.match(/^<\!doctype[^>]*>/i);
			if (this.fullpageDoctype && this.fullpageDoctype.length == 1)
			{
				html = html.replace(/^<\!doctype[^>]*>/i, '');
			}

			html = this.cleanSavePreCode(html, true);
			html = this.cleanConverters(html);
			html = this.cleanEmpty(html);

			// set code
			this.$editor.html(html);

			// set no editable
			this.setNonEditable();
			this.setSpansVerified();
			this.sync();
		},
		setFullpageDoctype: function()
		{
			if (this.fullpageDoctype && this.fullpageDoctype.length == 1)
			{
				var source = this.fullpageDoctype[0] + '\n' + this.$source.val();
				this.$source.val(source);
			}
		},
		setSpansVerified: function()
		{
			var spans = this.$editor.find('span');
			var replacementTag = 'inline';

			$.each(spans, function() {
				var outer = this.outerHTML;

				// Replace opening tag
				var regex = new RegExp('<' + this.tagName, 'gi');
				var newTag = outer.replace(regex, '<' + replacementTag);

				// Replace closing tag
				regex = new RegExp('</' + this.tagName, 'gi');
				newTag = newTag.replace(regex, '</' + replacementTag);

				$(this).replaceWith(newTag);
			});

		},
		setSpansVerifiedHtml: function(html)
		{
			html = html.replace(/<span(.*?)>/, '<inline$1>');
			return html.replace(/<\/span>/, '</inline>');
		},
		setNonEditable: function()
		{
			this.$editor.find('.noneditable').attr('contenteditable', false);
		},

		// SYNC
		sync: function(e)
		{
			var html = '';

			this.cleanUnverified();

			if (this.opts.fullpage) html = this.getCodeIframe();
			else html = this.$editor.html();

			html = this.syncClean(html);
			html = this.cleanRemoveEmptyTags(html);

			// is there a need to synchronize
			var source = this.cleanRemoveSpaces(this.$source.val(), false);
			var editor = this.cleanRemoveSpaces(html, false);

			if (source == editor)
			{
				// do not sync
				return false;
			}


			// fix second level up ul, ol
			html = html.replace(/<\/li><(ul|ol)>([\w\W]*?)<\/(ul|ol)>/gi, '<$1>$2</$1></li>');

			if ($.trim(html) === '<br>') html = '';

			// xhtml
			if (this.opts.xhtml)
			{
				var xhtmlTags = ['br', 'hr', 'img', 'link', 'input', 'meta'];
				$.each(xhtmlTags, function(i,s)
				{
					html = html.replace(new RegExp('<' + s + '(.*?[^\/$]?)>', 'gi'), '<' + s + '$1 />');
				});

			}

			// before callback
			html = this.callback('syncBefore', false, html);

			this.$source.val(html);
			this.setFullpageDoctype();

			// onchange & after callback
			this.callback('syncAfter', false, html);

			if (this.start === false)
			{

				if (typeof e != 'undefined')
				{
					switch(e.which)
					{
				        case 37: // left
				        break;
				        case 38: // up
				        break;
				        case 39: // right
				        break;
				        case 40: // down
				        break;

						default: this.callback('change', false, html);
					}
				}
				else
				{
					this.callback('change', false, html);
				}
			}

		},
		syncClean: function(html)
		{
			if (!this.opts.fullpage) html = this.cleanStripTags(html);

			// trim
			html = $.trim(html);

			// removeplaceholder
			html = this.placeholderRemoveFromCode(html);

			// remove space
			html = html.replace(/&#x200b;/gi, '');
			html = html.replace(/&#8203;/gi, '');
			html = html.replace(/<\/a>&nbsp;/gi, '<\/a> ');
			html = html.replace(/\u200B/g, '');

			if (html == '<p></p>' || html == '<p> </p>' || html == '<p>&nbsp;</p>')
			{
				html = '';
			}

			// link nofollow
			if (this.opts.linkNofollow)
			{
				html = html.replace(/<a(.*?)rel="nofollow"(.*?)>/gi, '<a$1$2>');
				html = html.replace(/<a(.*?)>/gi, '<a$1 rel="nofollow">');
			}

			// php code fix
			html = html.replace('<!--?php', '<?php');
			html = html.replace('?-->', '?>');

			// revert no editable
			html = html.replace(/<(.*?)class="noeditable"(.*?) contenteditable="false"(.*?)>/gi, '<$1class="noeditable"$2$3>');

			html = html.replace(/ data-tagblock=""/gi, '');
			html = html.replace(/<br\s?\/?>\n?<\/(P|H[1-6]|LI|ADDRESS|SECTION|HEADER|FOOTER|ASIDE|ARTICLE)>/gi, '</$1>');

			// remove image resize
			html = html.replace(/<span(.*?)id="redactor-image-box"(.*?)>([\w\W]*?)<img(.*?)><\/span>/gi, '$3<img$4>');
			html = html.replace(/<span(.*?)id="redactor-image-resizer"(.*?)>(.*?)<\/span>/gi, '');
			html = html.replace(/<span(.*?)id="redactor-image-editter"(.*?)>(.*?)<\/span>/gi, '');

			// remove empty lists
			html = html.replace(/<(ul|ol)>\s*\t*\n*<\/(ul|ol)>/gi, '');

			// remove font
			if (this.opts.cleanFontTag)
			{
				html = html.replace(/<font(.*?)>([\w\W]*?)<\/font>/gi, '$2');
			}

			// remove spans
			html = html.replace(/<span(.*?)>([\w\W]*?)<\/span>/gi, '$2');
			html = html.replace(/<inline>([\w\W]*?)<\/inline>/gi, '$1');
			html = html.replace(/<inline>/gi, '<span>');
			html = html.replace(/<inline /gi, '<span ');
			html = html.replace(/<\/inline>/gi, '</span>');

			if (this.opts.removeEmptyTags)
			{
				html = html.replace(/<span>([\w\W]*?)<\/span>/gi, '$1');
			}

			html = html.replace(/<span(.*?)class="redactor_placeholder"(.*?)>([\w\W]*?)<\/span>/gi, '');
			html = html.replace(/<img(.*?)contenteditable="false"(.*?)>/gi, '<img$1$2>');

			// special characters
			html = html.replace(/&/gi, '&');
			html = html.replace(/\u2122/gi, '&trade;');
			html = html.replace(/\u00a9/gi, '&copy;');
			html = html.replace(/\u2026/gi, '&hellip;');
			html = html.replace(/\u2014/gi, '&mdash;');
			html = html.replace(/\u2010/gi, '&dash;');

			html = this.cleanReConvertProtected(html);

			return html;
		},



		// BUILD
		buildStart: function()
		{
			// content
			this.content = '';

			// container
			this.$box = $('<div class="redactor_box" />');

			// textarea test
			if (this.$source[0].tagName === 'TEXTAREA') this.opts.textareamode = true;

			// mobile
			if (this.opts.mobile === false && this.isMobile())
			{
				this.buildMobile();
			}
			else
			{
				// get the content at the start
				this.buildContent();

				if (this.opts.iframe)
				{
					// build as iframe
					this.opts.autoresize = false;
					this.iframeStart();
				}
				else if (this.opts.textareamode) this.buildFromTextarea();
				else this.buildFromElement();

				// options and final setup
				if (!this.opts.iframe)
				{
					this.buildOptions();
					this.buildAfter();
				}
			}
		},
		buildMobile: function()
		{
			if (!this.opts.textareamode)
			{
				this.$editor = this.$source;
				this.$editor.hide();
				this.$source = this.buildCodearea(this.$editor);
				this.$source.val(this.content);
			}

			this.$box.insertAfter(this.$source).append(this.$source);
		},
		buildContent: function()
		{
			if (this.opts.textareamode) this.content = $.trim(this.$source.val());
			else this.content = $.trim(this.$source.html());
		},
		buildFromTextarea: function()
		{
			this.$editor = $('<div />');
			this.$box.insertAfter(this.$source).append(this.$editor).append(this.$source);

			// enable
			this.buildAddClasses(this.$editor);
			this.buildEnable();
		},
		buildFromElement: function()
		{
			this.$editor = this.$source;
			this.$source = this.buildCodearea(this.$editor);
			this.$box.insertAfter(this.$editor).append(this.$editor).append(this.$source);

			// enable
			this.buildEnable();
		},
		buildCodearea: function($source)
		{
			return $('<textarea />').attr('name', $source.attr('id')).css('height', this.sourceHeight);
		},
		buildAddClasses: function(el)
		{
			// append textarea classes to editable layer
			$.each(this.$source.get(0).className.split(/\s+/), function(i,s)
			{
				el.addClass('redactor_' + s);
			});
		},
		buildEnable: function()
		{
			this.$editor.addClass('redactor_editor').attr({ 'contenteditable': true, 'dir': this.opts.direction });
			this.$source.attr('dir', this.opts.direction).hide();

			// set code
			this.set(this.content, true, false);
		},
		buildOptions: function()
		{
			var $source = this.$editor;
			if (this.opts.iframe) $source = this.$frame;

			// options
			if (this.opts.tabindex) $source.attr('tabindex', this.opts.tabindex);

			if (this.opts.minHeight) $source.css('min-height', this.opts.minHeight + 'px');
			// FF fix bug with line-height rendering
			else if (this.browser('mozilla') && this.opts.linebreaks)
			{
				this.$editor.css('min-height', '45px');
			}
			// FF fix bug with line-height rendering
			if (this.browser('mozilla') && this.opts.linebreaks)
			{
				this.$editor.css('padding-bottom', '10px');
			}


			if (this.opts.maxHeight)
			{
				this.opts.autoresize = false;
				this.sourceHeight = this.opts.maxHeight;
			}
			if (this.opts.wym) this.$editor.addClass('redactor_editor_wym');
			if (this.opts.typewriter) this.$editor.addClass('redactor-editor-typewriter');
			if (!this.opts.autoresize) $source.css('height', this.sourceHeight);

		},
		buildAfter: function()
		{
			this.start = false;

			// load toolbar
			if (this.opts.toolbar)
			{
				this.opts.toolbar = this.toolbarInit(this.opts.curLang);
				this.toolbarBuild();
			}

			// modal templates
			this.modalTemplatesInit();

			// plugins
			this.buildPlugins();

			// enter, tab, etc.
			this.buildBindKeyboard();

			// autosave
			if (this.opts.autosave) this.autosave();

			// observers
			setTimeout($.proxy(this.observeStart, this), 4);

			// FF fix
			if (this.browser('mozilla'))
			{
				try {
					this.document.execCommand('enableObjectResizing', false, false);
					this.document.execCommand('enableInlineTableEditing', false, false);
				} catch (e) {}
			}

			// focus
			if (this.opts.focus) setTimeout($.proxy(this.focus, this), 100);

			// code mode
			if (!this.opts.visual)
			{
				setTimeout($.proxy(function()
				{
					this.opts.visual = true;
					this.toggle(false);

				}, this), 200);
			}

			// init callback
			this.callback('init');
		},
		buildBindKeyboard: function()
		{
			this.dblEnter = 0;

			if (this.opts.dragUpload && (this.opts.imageUpload !== false || this.opts.s3 !== false))
			{
				this.$editor.on('drop.redactor', $.proxy(this.buildEventDrop, this));
			}

			this.$editor.on('click.redactor', $.proxy(function()
			{
				this.selectall = false;

			}, this));

			this.$editor.on('input.redactor', $.proxy(this.sync, this));
			this.$editor.on('paste.redactor', $.proxy(this.buildEventPaste, this));
			this.$editor.on('keydown.redactor', $.proxy(this.buildEventKeydown, this));
			this.$editor.on('keyup.redactor', $.proxy(this.buildEventKeyup, this));

			// textarea callback
			if ($.isFunction(this.opts.textareaKeydownCallback))
			{
				this.$source.on('keydown.redactor-textarea', $.proxy(this.opts.textareaKeydownCallback, this));
			}

			// focus callback
			if ($.isFunction(this.opts.focusCallback))
			{
				this.$editor.on('focus.redactor', $.proxy(this.opts.focusCallback, this));
			}

			var clickedElement;
			$(document).mousedown(function(e) {
				clickedElement = $(e.target);
			});

			// blur callback
			this.$editor.on('blur.redactor', $.proxy(function(e)
			{
				if (!$(clickedElement).hasClass('redactor_toolbar') && $(clickedElement).parents('.redactor_toolbar').size() == 0)
				{
					this.selectall = false;
					if ($.isFunction(this.opts.blurCallback)) this.callback('blur', e);
				}
			}, this));

		},
		buildEventDrop: function(e)
		{
			e = e.originalEvent || e;

			if (window.FormData === undefined || !e.dataTransfer) return true;

		    var length = e.dataTransfer.files.length;
		    if (length == 0) return true;

		    e.preventDefault();

	        var file = e.dataTransfer.files[0];

	        if (this.opts.dnbImageTypes !== false && this.opts.dnbImageTypes.indexOf(file.type) == -1)
	        {
		        return true;
	        }

			this.bufferSet();

			this.showProgressBar();

			if (this.opts.s3 === false)
			{
				this.dragUploadAjax(this.opts.imageUpload, file, true, e, this.opts.imageUploadParam);
			}
			else
			{
				this.s3uploadFile(file);
			}


		},
		buildEventPaste: function(e)
		{
			var oldsafari = false;
			if (this.browser('webkit') && navigator.userAgent.indexOf('Chrome') === -1)
			{
				var arr = this.browser('version').split('.');
				if (arr[0] < 536) oldsafari = true;
			}

			if (oldsafari) return true;

			// paste except opera (not webkit)
			if (this.browser('opera')) return true;

			// clipboard upload
			if (this.opts.clipboardUpload && this.buildEventClipboardUpload(e)) return true;

			if (this.opts.cleanup)
			{
				this.rtePaste = true;

				this.selectionSave();

				if (!this.selectall)
				{
					if (this.opts.autoresize === true && this.fullscreen !== true)
					{
						this.$editor.height(this.$editor.height());
						this.saveScroll = this.document.body.scrollTop;
					}
					else
					{
						this.saveScroll = this.$editor.scrollTop();
					}
				}

				var frag = this.extractContent();

				setTimeout($.proxy(function()
				{
					var pastedFrag = this.extractContent();
					this.$editor.append(frag);

					this.selectionRestore();

					var html = this.getFragmentHtml(pastedFrag);
					this.pasteClean(html);

					if (this.opts.autoresize === true && this.fullscreen !== true) this.$editor.css('height', 'auto');

				}, this), 1);
			}
		},
		buildEventClipboardUpload: function(e)
		{
			var event = e.originalEvent || e;
			this.clipboardFilePaste = false;


			if (typeof(event.clipboardData) === 'undefined') return false;
			if (event.clipboardData.items)
			{
				var file = event.clipboardData.items[0].getAsFile();
				if (file !== null)
				{
					this.bufferSet();
					this.clipboardFilePaste = true;

					var reader = new FileReader();
					reader.onload = $.proxy(this.pasteClipboardUpload, this);
			        reader.readAsDataURL(file);

			        return true;
				}
			}

			return false;

		},
		buildEventKeydown: function(e)
		{
			if (this.rtePaste) return false;

			var key = e.which;
			var ctrl = e.ctrlKey || e.metaKey;
			var parent = this.getParent();
			var current = this.getCurrent();
			var block = this.getBlock();
			var pre = false;

			this.callback('keydown', e);

			/*
				firefox cmd+left/Cmd+right browser back/forward fix -
				http://joshrhoderick.wordpress.com/2010/05/05/how-firefoxs-command-key-bug-kills-usability-on-the-mac/
			*/
			if (this.browser('mozilla') && "modify" in window.getSelection())
			{
				if ((ctrl) && (e.keyCode===37 || e.keyCode===39))
				{
					var selection = this.getSelection();
					var lineOrWord = (e.metaKey ? "line" : "word");
					if (e.keyCode===37)
					{
						selection.modify("extend","left",lineOrWord);
						if (!e.shiftKey)
						{
							selection.collapseToStart();
						}
					}
					if (e.keyCode===39)
					{
						selection.modify("extend","right",lineOrWord);
						if (!e.shiftKey)
						{
							selection.collapseToEnd();
						}
					}

					e.preventDefault();
				}
			}


			this.imageResizeHide(false);

			// pre & down
			if ((parent && $(parent).get(0).tagName === 'PRE') || (current && $(current).get(0).tagName === 'PRE'))
			{
				pre = true;
				if (key === this.keyCode.DOWN) this.insertAfterLastElement(block);
			}

			// down
			if (key === this.keyCode.DOWN)
			{
				if (parent && $(parent)[0].tagName === 'BLOCKQUOTE') this.insertAfterLastElement(parent);
				if (current && $(current)[0].tagName === 'BLOCKQUOTE') this.insertAfterLastElement(current);

				if (parent && $(parent)[0].tagName === 'P' && $(parent).parent()[0].tagName == 'BLOCKQUOTE')
				{
					this.insertAfterLastElement(parent, $(parent).parent()[0]);
				}
				if (current && $(current)[0].tagName === 'P' && parent && $(parent)[0].tagName == 'BLOCKQUOTE')
				{
					this.insertAfterLastElement(current, parent);
				}
			}

			// shortcuts setup
			this.shortcuts(e, key);

			// buffer setup
			if (ctrl && key === 90 && !e.shiftKey && !e.altKey) // z key
			{
				e.preventDefault();
				if (this.opts.buffer.length) this.bufferUndo();
				else this.document.execCommand('undo', false, false);
				return;
			}
			// undo
			else if (ctrl && key === 90 && e.shiftKey && !e.altKey)
			{
				e.preventDefault();
				if (this.opts.rebuffer.length != 0) this.bufferRedo();
				else this.document.execCommand('redo', false, false);
				return;
			}

			// space
			if (key == 32)
			{
				this.bufferSet();
			}

			// select all
			if (ctrl && key === 65)
			{
				this.bufferSet();
				this.selectall = true;
			}
			else if (key != this.keyCode.LEFT_WIN && !ctrl)
			{
				this.selectall = false;
			}

			// enter
			if (key == this.keyCode.ENTER && !e.shiftKey && !e.ctrlKey && !e.metaKey)
			{
				// remove selected content on enter
				var range = this.getRange();
				if (range && range.collapsed === false)
				{
					sel = this.getSelection();
					if (sel.rangeCount)
					{
						range.deleteContents();
					}
				}

				// In ie, opera in the tables are created paragraphs, fix it.
				if (this.browser('msie') && (parent.nodeType == 1 && (parent.tagName == 'TD' || parent.tagName == 'TH')))
				{
					e.preventDefault();
					this.bufferSet();
					this.insertNode(document.createElement('br'));
					this.callback('enter', e);
					return false;
				}

				// blockquote exit
				if (block && (block.tagName == 'BLOCKQUOTE' || $(block).parent()[0].tagName == 'BLOCKQUOTE'))
				{
					if (this.isEndOfElement())
					{
						if (this.dblEnter == 1)
						{
							var element;
							var last;
							if (block.tagName == 'BLOCKQUOTE')
							{
								last = 'br';
								element = block;
							}
							else
							{
								last = 'p';
								element = $(block).parent()[0];
							}

							e.preventDefault();
							this.insertingAfterLastElement(element);
							this.dblEnter = 0;

							if (last == 'p')
							{
								$(block).parent().find('p').last().remove();
							}
							else
							{
								var tmp = $.trim($(block).html());
								$(block).html(tmp.replace(/<br\s?\/?>$/i, ''));
							}

							return;
						}
						else this.dblEnter++;
					}
					else this.dblEnter++;
				}

				// pre
				if (pre === true)
				{
					return this.buildEventKeydownPre(e, current);
				}
				else
				{
					if (!this.opts.linebreaks)
					{
						// lists exit
						if (block && block.tagName == 'LI')
						{
							var listCurrent = this.getBlock();
							if (listCurrent !== false || listCurrent.tagName === 'LI')
							{
								var listText = $.trim($(block).text());
								var listCurrentText = $.trim($(listCurrent).text());
								if (listText == ''
									&& listCurrentText == ''
									&& $(listCurrent).next('li').size() == 0
									&& $(listCurrent).parents('li').size() == 0)
								{
									this.bufferSet();

									var $list = $(listCurrent).closest('ol, ul');
									$(listCurrent).remove();
									var node = $('<p>' + this.opts.invisibleSpace + '</p>');
									$list.after(node);
									this.selectionStart(node);

									this.sync();
									this.callback('enter', e);
									return false;
								}
							}

						}

						// replace div to p
						if (block && this.opts.rBlockTest.test(block.tagName))
						{
							// hit enter
							this.bufferSet();

							setTimeout($.proxy(function()
							{
								var blockElem = this.getBlock();
								if (blockElem.tagName === 'DIV' && !$(blockElem).hasClass('redactor_editor'))
								{
									var node = $('<p>' + this.opts.invisibleSpace + '</p>');
									$(blockElem).replaceWith(node);
									this.selectionStart(node);
								}

							}, this), 1);
						}
						else if (block === false)
						{
							// hit enter
							this.bufferSet();
							var node = $('<p>' + this.opts.invisibleSpace + '</p>');
							this.insertNode(node[0]);
							this.selectionStart(node);
							this.callback('enter', e);
							return false;
						}

					}

					if (this.opts.linebreaks)
					{
						// replace div to br
						if (block && this.opts.rBlockTest.test(block.tagName))
						{
							// hit enter
							this.bufferSet();

							setTimeout($.proxy(function()
							{
								var blockElem = this.getBlock();
								if ((blockElem.tagName === 'DIV' || blockElem.tagName === 'P') && !$(blockElem).hasClass('redactor_editor'))
								{
									this.replaceLineBreak(blockElem);
								}

							}, this), 1);
						}
						else
						{
							return this.buildEventKeydownInsertLineBreak(e);
						}
					}

					// blockquote, figcaption
					if (block.tagName == 'BLOCKQUOTE' || block.tagName == 'FIGCAPTION')
					{
						return this.buildEventKeydownInsertLineBreak(e);
					}

				}

				this.callback('enter', e);
			}
			else if (key === this.keyCode.ENTER && (e.ctrlKey || e.shiftKey)) // Shift+Enter or Ctrl+Enter
			{
				this.bufferSet();

				e.preventDefault();
				this.insertLineBreak();
			}

			// tab (cmd + [)
			if ((key === this.keyCode.TAB || e.metaKey && key === 219) && this.opts.shortcuts)
			{
				return this.buildEventKeydownTab(e, pre, key);
			}

			// delete zero-width space before the removing
			if (key === this.keyCode.BACKSPACE) this.buildEventKeydownBackspace(e, current, parent);

		},
		buildEventKeydownPre: function(e, current)
		{
			e.preventDefault();
			this.bufferSet();
			var html = $(current).parent().text();
			this.insertNode(document.createTextNode('\n'));
			if (html.search(/\s$/) == -1)
			{
				this.insertNode(document.createTextNode('\n'));
			}

			this.sync();
			this.callback('enter', e);
			return false;
		},
		buildEventKeydownTab: function(e, pre, key)
		{
			if (!this.opts.tabFocus) return true;
			if (this.isEmpty(this.get()) && this.opts.tabSpaces === false) return true;

			e.preventDefault();

			if (pre === true && !e.shiftKey)
			{
				this.bufferSet();
				this.insertNode(document.createTextNode('\t'));
				this.sync();
				return false;

			}
			else if (this.opts.tabSpaces !== false)
			{
				this.bufferSet();
				this.insertNode(document.createTextNode(Array(this.opts.tabSpaces + 1).join('\u00a0')));
				this.sync();
				return false;
			}
			else
			{
				if (!e.shiftKey) this.indentingIndent();
				else this.indentingOutdent();
			}

			return false;
		},
		buildEventKeydownBackspace: function(e, current, parent)
		{
			// remove empty list in table
			if (parent && current && parent.parentNode.tagName == 'TD'
				&& parent.tagName == 'UL' && current.tagName == 'LI' && $(parent).children('li').size() == 1)
			{
				var text = $(current).text().replace(/[\u200B-\u200D\uFEFF]/g, '');
				if (text == '')
				{
					var node = parent.parentNode;
					$(parent).remove();
					this.selectionStart(node);
					this.sync();
					return false;
				}
			}

			if (typeof current.tagName !== 'undefined' && /^(H[1-6])$/i.test(current.tagName))
			{
				var node;
				if (this.opts.linebreaks === false) node = $('<p>' + this.opts.invisibleSpace + '</p>');
				else node = $('<br>' + this.opts.invisibleSpace);

				$(current).replaceWith(node);
				this.selectionStart(node);
				this.sync();
			}

			if (typeof current.nodeValue !== 'undefined' && current.nodeValue !== null)
			{
				if (current.remove && current.nodeType === 3 && current.nodeValue.match(/[^\u200B]/g) == null)
				{
					$(current).prev().remove();
					this.sync();
				}
			}
		},
		buildEventKeydownInsertLineBreak: function(e)
		{
			this.bufferSet();
			e.preventDefault();
			this.insertLineBreak();
			this.callback('enter', e);
			return;
		},
		buildEventKeyup: function(e)
		{
			if (this.rtePaste) return false;

			var key = e.which;
			var parent = this.getParent();
			var current = this.getCurrent();

			// replace to p before / after the table or body
			if (!this.opts.linebreaks && current.nodeType == 3 && (parent == false || parent.tagName == 'BODY'))
			{
				var node = $('<p>').append($(current).clone());
				$(current).replaceWith(node);
				var next = $(node).next();
				if (typeof(next[0]) !== 'undefined' && next[0].tagName == 'BR')
				{
					next.remove();
				}

				this.selectionEnd(node);
			}

			// convert links
			if ((this.opts.convertLinks || this.opts.convertImageLinks || this.opts.convertVideoLinks) && key === this.keyCode.ENTER)
			{
				this.buildEventKeyupConverters();
			}

			// if empty
			if (key === this.keyCode.DELETE || key === this.keyCode.BACKSPACE)
			{
				return this.formatEmpty(e);
			}

			this.callback('keyup', e);
			this.sync(e);
		},
		buildEventKeyupConverters: function()
		{
			this.formatLinkify(this.opts.linkProtocol, this.opts.convertLinks, this.opts.convertImageLinks, this.opts.convertVideoLinks, this.opts.linkSize);

			setTimeout($.proxy(function()
			{
				if (this.opts.convertImageLinks) this.observeImages();
				if (this.opts.observeLinks) this.observeLinks();
			}, this), 5);
		},
		buildPlugins: function()
		{
			if (!this.opts.plugins ) return;

			$.each(this.opts.plugins, $.proxy(function(i, s)
			{
				if (RedactorPlugins[s])
				{
					$.extend(this, RedactorPlugins[s]);
					if ($.isFunction( RedactorPlugins[ s ].init)) this.init();
				}

			}, this ));
		},

		// IFRAME
		iframeStart: function()
		{
			this.iframeCreate();

			if (this.opts.textareamode) this.iframeAppend(this.$source);
			else
			{
				this.$sourceOld = this.$source.hide();
				this.$source = this.buildCodearea(this.$sourceOld);
				this.iframeAppend(this.$sourceOld);
			}
		},
		iframeAppend: function(el)
		{
			this.$source.attr('dir', this.opts.direction).hide();
			this.$box.insertAfter(el).append(this.$frame).append(this.$source);
		},
		iframeCreate: function()
		{
			this.$frame = $('<iframe style="width: 100%;" frameborder="0" />').one('load', $.proxy(function()
			{
				if (this.opts.fullpage)
				{
					this.iframePage();

					if (this.content === '') this.content = this.opts.invisibleSpace;

					this.$frame.contents()[0].write(this.content);
					this.$frame.contents()[0].close();

					var timer = setInterval($.proxy(function()
					{
						if (this.$frame.contents().find('body').html())
						{
							clearInterval(timer);
							this.iframeLoad();
						}

					}, this), 0);
				}
				else this.iframeLoad();

			}, this));
		},
		iframeDoc: function()
		{
			return this.$frame[0].contentWindow.document;
		},
		iframePage: function()
		{
			var doc = this.iframeDoc();
			if (doc.documentElement) doc.removeChild(doc.documentElement);

			return doc;
		},
		iframeAddCss: function(css)
		{
			css = css || this.opts.css;

			if (this.isString(css))
			{
				this.$frame.contents().find('head').append('<link rel="stylesheet" href="' + css + '" />');
			}

			if ($.isArray(css))
			{
				$.each(css, $.proxy(function(i, url)
				{
					this.iframeAddCss(url);

				}, this));
			}
		},
		iframeLoad: function()
		{
			this.$editor = this.$frame.contents().find('body').attr({ 'contenteditable': true, 'dir': this.opts.direction });

			// set document & window
			if (this.$editor[0])
			{
				this.document = this.$editor[0].ownerDocument;
				this.window = this.document.defaultView || window;
			}

			// iframe css
			this.iframeAddCss();

			if (this.opts.fullpage)
			{
				this.setFullpageOnInit(this.$source.val());
			}
			else this.set(this.content, true, false);

			this.buildOptions();
			this.buildAfter();
		},

		// PLACEHOLDER
		placeholderInit: function()
		{
			if (this.opts.placeholder !== false)
			{
				this.placeholderText = this.opts.placeholder;
				this.opts.placeholder = true;
			}
			else
			{
				if (typeof this.$element.attr('placeholder') == 'undefined' || this.$element.attr('placeholder') == '')
				{
					this.opts.placeholder = false;
				}
				else
				{
					this.placeholderText = this.$element.attr('placeholder');
					this.opts.placeholder = true;
				}
			}
		},
		placeholderStart: function(html)
		{
			if (this.opts.placeholder === false)
			{
				return false;
			}

			if (this.isEmpty(html))
			{
				this.opts.focus = false;
				this.placeholderOnFocus();
				this.placeholderOnBlur();

				return this.placeholderGet();
			}
			else
			{
				this.placeholderOnBlur();
			}

			return false;
		},
		placeholderOnFocus: function()
		{
			this.$editor.on('focus.redactor_placeholder', $.proxy(this.placeholderFocus, this));
		},
		placeholderOnBlur: function()
		{
			this.$editor.on('blur.redactor_placeholder', $.proxy(this.placeholderBlur, this));
		},
		placeholderGet: function()
		{
			var ph = $('<span class="redactor_placeholder">').data('redactor', 'verified')
			.attr('contenteditable', false).text(this.placeholderText);

			if (this.opts.linebreaks === false)
			{
				return $('<p>').append(ph);
			}
			else return ph;
		},
		placeholderBlur: function()
		{
			var html = this.get();
			if (this.isEmpty(html))
			{
				this.placeholderOnFocus();
				this.$editor.html(this.placeholderGet());
			}
		},
		placeholderFocus: function()
		{
			this.$editor.find('span.redactor_placeholder').remove();

			var html = '';
			if (this.opts.linebreaks === false)
			{
				html = this.opts.emptyHtml;
			}

			this.$editor.off('focus.redactor_placeholder');
			this.$editor.html(html);

			if (this.opts.linebreaks === false)
			{
				// place the cursor inside emptyHtml
				this.selectionStart(this.$editor.children()[0]);
			}
			else
			{
				this.focus();
			}

			this.sync();
		},
		placeholderRemoveFromEditor: function()
		{
			this.$editor.find('span.redactor_placeholder').remove();
			this.$editor.off('focus.redactor_placeholder');
		},
		placeholderRemoveFromCode: function(html)
		{
			return html.replace(/<span class="redactor_placeholder"(.*?)>(.*?)<\/span>/i, '');
		},

		// SHORTCUTS
		shortcuts: function(e, key)
		{

			// disable browser's hot keys for bold and italic
			if (!this.opts.shortcuts)
			{
				if ((e.ctrlKey || e.metaKey) && (key === 66 || key === 73))
				{
					e.preventDefault();
				}

				return false;
			}

			$.each(this.opts.shortcuts, $.proxy(function(str, command)
			{
				var keys = str.split(',');
				for (var i in keys)
				{
					if (typeof keys[i] === 'string')
					{
						this.shortcutsHandler(e, $.trim(keys[i]), $.proxy(function()
						{
							eval(command);
						}, this));
					}

				}

			}, this));


		},
		shortcutsHandler: function(e, keys, origHandler)
		{
			// based on https://github.com/jeresig/jquery.hotkeys
			var hotkeysSpecialKeys =
			{
				8: "backspace", 9: "tab", 10: "return", 13: "return", 16: "shift", 17: "ctrl", 18: "alt", 19: "pause",
				20: "capslock", 27: "esc", 32: "space", 33: "pageup", 34: "pagedown", 35: "end", 36: "home",
				37: "left", 38: "up", 39: "right", 40: "down", 45: "insert", 46: "del", 59: ";", 61: "=",
				96: "0", 97: "1", 98: "2", 99: "3", 100: "4", 101: "5", 102: "6", 103: "7",
				104: "8", 105: "9", 106: "*", 107: "+", 109: "-", 110: ".", 111 : "/",
				112: "f1", 113: "f2", 114: "f3", 115: "f4", 116: "f5", 117: "f6", 118: "f7", 119: "f8",
				120: "f9", 121: "f10", 122: "f11", 123: "f12", 144: "numlock", 145: "scroll", 173: "-", 186: ";", 187: "=",
				188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\", 221: "]", 222: "'"
			};


			var hotkeysShiftNums =
			{
				"`": "~", "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&",
				"8": "*", "9": "(", "0": ")", "-": "_", "=": "+", ";": ": ", "'": "\"", ",": "<",
				".": ">",  "/": "?",  "\\": "|"
			};

			keys = keys.toLowerCase().split(" ");
			var special = hotkeysSpecialKeys[e.keyCode],
				character = String.fromCharCode( e.which ).toLowerCase(),
				modif = "", possible = {};

			$.each([ "alt", "ctrl", "meta", "shift"], function(index, specialKey)
			{
				if (e[specialKey + 'Key'] && special !== specialKey)
				{
					modif += specialKey + '+';
				}
			});


			if (special)
			{
				possible[modif + special] = true;
			}

			if (character)
			{
				possible[modif + character] = true;
				possible[modif + hotkeysShiftNums[character]] = true;

				// "$" can be triggered as "Shift+4" or "Shift+$" or just "$"
				if (modif === "shift+")
				{
					possible[hotkeysShiftNums[character]] = true;
				}
			}

			for (var i = 0, l = keys.length; i < l; i++)
			{
				if (possible[keys[i]])
				{
					e.preventDefault();
					return origHandler.apply(this, arguments);
				}
			}
		},

		// FOCUS
		focus: function()
		{
			if (!this.browser('opera'))
			{
				this.window.setTimeout($.proxy(this.focusSet, this, true), 1);
			}
			else
			{
				this.$editor.focus();
			}
		},
		focusWithSaveScroll: function()
		{
			if (this.browser('msie'))
			{
				var top = this.document.documentElement.scrollTop;
			}

			this.$editor.focus();

			if (this.browser('msie'))
			{
				this.document.documentElement.scrollTop = top;
			}
		},
		focusEnd: function()
		{
			if (!this.browser('mozilla'))
			{
				this.focusSet();
			}
			else
			{
				if (this.opts.linebreaks === false)
				{
					var last = this.$editor.children().last();

					this.$editor.focus();
					this.selectionEnd(last);
				}
				else
				{
					this.focusSet();
				}
			}
       	},
		focusSet: function(collapse, element)
		{
			this.$editor.focus();

			if (typeof element == 'undefined')
			{
				element = this.$editor[0];
			}

			var range = this.getRange();
			range.selectNodeContents(element);

			// collapse - controls the position of focus: the beginning (true), at the end (false).
			range.collapse(collapse || false);

			var sel = this.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
		},

		// TOGGLE
		toggle: function(direct)
		{
			if (this.opts.visual) this.toggleCode(direct);
			else this.toggleVisual();
		},
		toggleVisual: function()
		{
			var html = this.$source.hide().val();
			if (typeof this.modified !== 'undefined')
			{
				var modified = this.modified.replace(/\n/g, '');

				var thtml = html.replace(/\n/g, '');
				thtml = this.cleanRemoveSpaces(thtml, false);

				this.modified = this.cleanRemoveSpaces(modified, false) !== thtml;
			}

			if (this.modified)
			{
				// don't remove the iframe even if cleared all.
				if (this.opts.fullpage && html === '')
				{
					this.setFullpageOnInit(html);
				}
				else
				{
					this.set(html);
					if (this.opts.fullpage)
					{
						this.buildBindKeyboard();
					}
				}

				this.callback('change', false, html);
			}

			if (this.opts.iframe) this.$frame.show();
			else this.$editor.show();

			if (this.opts.fullpage) this.$editor.attr('contenteditable', true );

			this.$source.off('keydown.redactor-textarea-indenting');

			this.$editor.focus();
			this.selectionRestore();

			this.observeStart();
			this.buttonActiveVisual();
			this.buttonInactive('html');
			this.opts.visual = true;


		},
		toggleCode: function(direct)
		{
			if (direct !== false) this.selectionSave();

			var height = null;
			if (this.opts.iframe)
			{
				height = this.$frame.height();
				if (this.opts.fullpage) this.$editor.removeAttr('contenteditable');
				this.$frame.hide();
			}
			else
			{
				height = this.$editor.innerHeight();
				this.$editor.hide();
			}

			var html = this.$source.val();

			// tidy html
			if (html !== '' && this.opts.tidyHtml)
			{
				this.$source.val(this.cleanHtml(html));
			}

			this.modified = html;

			this.$source.height(height).show().focus();

			// textarea indenting
			this.$source.on('keydown.redactor-textarea-indenting', this.textareaIndenting);

			this.buttonInactiveVisual();
			this.buttonActive('html');
			this.opts.visual = false;
		},
		textareaIndenting: function(e)
		{
			if (e.keyCode === 9)
			{
				var $el = $(this);
				var start = $el.get(0).selectionStart;
				$el.val($el.val().substring(0, start) + "\t" + $el.val().substring($el.get(0).selectionEnd));
				$el.get(0).selectionStart = $el.get(0).selectionEnd = start + 1;
				return false;
			}
		},

		// AUTOSAVE
		autosave: function()
		{
			var savedHtml = false;
			this.autosaveInterval = setInterval($.proxy(function()
			{
				var html = this.get();
				if (savedHtml !== html)
				{
					var name = this.$source.attr('name');
					$.ajax({
						url: this.opts.autosave,
						type: 'post',
						data: 'name=' + name + '&' + name + '=' + escape(encodeURIComponent(html)),
						success: $.proxy(function(data)
						{
							var json = $.parseJSON(data);
							if (typeof json.error == 'undefined')
							{
								// success
								this.callback('autosave', false, json);
							}
							else
							{
								// error
								this.callback('autosaveError', false, json);
							}

							savedHtml = html;

						}, this)
					});
				}
			}, this), this.opts.autosaveInterval*1000);
		},

		// TOOLBAR
		toolbarBuild: function()
		{
			// hide on mobile
			if (this.isMobile() && this.opts.buttonsHideOnMobile.length > 0)
			{
				$.each(this.opts.buttonsHideOnMobile, $.proxy(function(i, s)
				{
					var index = this.opts.buttons.indexOf(s);
					this.opts.buttons.splice(index, 1);

				}, this));
			}

			// extend buttons
			if (this.opts.air)
			{
				this.opts.buttons = this.opts.airButtons;
			}
			else
			{
				if (!this.opts.buttonSource)
				{
					var index = this.opts.buttons.indexOf('html');
					this.opts.buttons.splice(index, 1);
				}
			}

			// formatting tags
			if (this.opts.toolbar)
			{
				$.each(this.opts.toolbar.formatting.dropdown, $.proxy(function (i, s)
				{
					if ($.inArray(i, this.opts.formattingTags ) == '-1') delete this.opts.toolbar.formatting.dropdown[i];

				}, this));
			}

			// if no buttons don't create a toolbar
			if (this.opts.buttons.length === 0) return false;

			// air enable
			this.airEnable();

			// toolbar build
			this.$toolbar = $('<ul>').addClass('redactor_toolbar').attr('id', 'redactor_toolbar_' + this.uuid);

			if (this.opts.typewriter)
			{
				this.$toolbar.addClass('redactor-toolbar-typewriter');
			}

			if (this.opts.toolbarOverflow && this.isMobile())
			{
				this.$toolbar.addClass('redactor-toolbar-overflow');
			}

			if (this.opts.air)
			{
				// air box
				this.$air = $('<div class="redactor_air">').attr('id', 'redactor_air_' + this.uuid).hide();
				this.$air.append(this.$toolbar);
				$('body').append(this.$air);
			}
			else
			{
				if (this.opts.toolbarExternal)
				{
					this.$toolbar.addClass('redactor-toolbar-external');
					$(this.opts.toolbarExternal).html(this.$toolbar);
				}
				else this.$box.prepend(this.$toolbar);
			}

			$.each(this.opts.buttons, $.proxy(function(i, btnName)
			{
				if (this.opts.toolbar[btnName])
				{
					var btnObject = this.opts.toolbar[btnName];
					if (this.opts.fileUpload === false && btnName === 'file') return true;
					this.$toolbar.append( $('<li>').append(this.buttonBuild(btnName, btnObject)));
				}

			}, this));

			this.$toolbar.find('a').attr('tabindex', '-1');

			// fixed
			if (this.opts.toolbarFixed)
			{
				this.toolbarObserveScroll();
				$(this.opts.toolbarFixedTarget).on('scroll.redactor', $.proxy(this.toolbarObserveScroll, this));
			}

			// buttons response
			if (this.opts.activeButtons)
			{
				this.$editor.on('mouseup.redactor keyup.redactor', $.proxy(this.buttonActiveObserver, this));
			}
		},
		toolbarObserveScroll: function()
		{
			var scrollTop = $(this.opts.toolbarFixedTarget).scrollTop();

			var boxTop = 0;
			var left = 0;
			var end = 0;

			if (this.opts.toolbarFixedTarget === document)
			{
				boxTop = this.$box.offset().top;
			}
			else
			{
				boxTop = 1;
			}

			end = boxTop + this.$box.height() + 40;

			if (scrollTop > boxTop)
			{
				var width = '100%';
				if (this.opts.toolbarFixedBox)
				{
					left = this.$box.offset().left;
					width = this.$box.innerWidth();
					this.$toolbar.addClass('toolbar_fixed_box');
				}

				this.toolbarFixed = true;

				if (this.opts.toolbarFixedTarget === document)
				{
					this.$toolbar.css({
						position: 'fixed',
						width: width,
						zIndex: 10005,
						top: this.opts.toolbarFixedTopOffset + 'px',
						left: left
					});
				}
				else
				{
					this.$toolbar.css({
						position: 'absolute',
						width: width,
						zIndex: 10005,
						top: (this.opts.toolbarFixedTopOffset + scrollTop) + 'px',
						left: 0
					});
				}

				if (scrollTop < end) this.$toolbar.css('visibility', 'visible');
				else this.$toolbar.css('visibility', 'hidden');
			}
			else
			{
				this.toolbarFixed = false;
				this.$toolbar.css({
					position: 'relative',
					width: 'auto',
					top: 0,
					left: left
				});

				if (this.opts.toolbarFixedBox) this.$toolbar.removeClass('toolbar_fixed_box');
			}
		},

		// AIR
		airEnable: function()
		{
			if (!this.opts.air) return;

			this.$editor.on('mouseup.redactor keyup.redactor', this, $.proxy(function(e)
			{
				var text = this.getSelectionText();

				if (e.type === 'mouseup' && text != '') this.airShow(e);
				if (e.type === 'keyup' && e.shiftKey && text != '')
				{
					var $focusElem = $(this.getElement(this.getSelection().focusNode)), offset = $focusElem.offset();
					offset.height = $focusElem.height();
					this.airShow(offset, true);
				}

			}, this));
		},
		airShow: function (e, keyboard)
		{
			if (!this.opts.air) return;

			var left, top;
			$('.redactor_air').hide();

			if (keyboard)
			{
				left = e.left;
				top = e.top + e.height + 14;

				if (this.opts.iframe)
				{
					top += this.$box.position().top - $(this.document).scrollTop();
					left += this.$box.position().left;
				}
			}
			else
			{
				var width = this.$air.innerWidth();

				left = e.clientX;
				if ($(this.document).width() < (left + width)) left -= width;

				top = e.clientY + 14;
				if (this.opts.iframe)
				{
					top += this.$box.position().top;
					left += this.$box.position().left;
				}
				else top += $( this.document ).scrollTop();
			}

			this.$air.css({
				left: left + 'px',
				top: top + 'px'
			}).show();

			this.airBindHide();
		},
		airBindHide: function()
		{
			if (!this.opts.air) return;

			var hideHandler = $.proxy(function(doc)
			{
				$(doc).on('mousedown.redactor', $.proxy(function(e)
				{
					if ($( e.target ).closest(this.$toolbar).length === 0)
					{
						this.$air.fadeOut(100);
						this.selectionRemove();
						$(doc).off(e);
					}

				}, this)).on('keydown.redactor', $.proxy(function(e)
				{
					if (e.which === this.keyCode.ESC)
					{
						this.getSelection().collapseToStart();
					}

					this.$air.fadeOut(100);
					$(doc).off(e);

				}, this));
			}, this);

			// Hide the toolbar at events in all documents (iframe)
			hideHandler(document);
			if (this.opts.iframe) hideHandler(this.document);
		},
		airBindMousemoveHide: function()
		{
			if (!this.opts.air) return;

			var hideHandler = $.proxy(function(doc)
			{
				$(doc).on('mousemove.redactor', $.proxy(function(e)
				{
					if ($( e.target ).closest(this.$toolbar).length === 0)
					{
						this.$air.fadeOut(100);
						$(doc).off(e);
					}

				}, this));
			}, this);

			// Hide the toolbar at events in all documents (iframe)
			hideHandler(document);
			if (this.opts.iframe) hideHandler(this.document);
		},

		// DROPDOWNS
		dropdownBuild: function($dropdown, dropdownObject)
		{
			$.each(dropdownObject, $.proxy(function(btnName, btnObject)
			{
				if (!btnObject.className) btnObject.className = '';

				var $item;
				if (btnObject.name === 'separator') $item = $('<a class="redactor_separator_drop">');
				else
				{
					$item = $('<a href="#" class="' + btnObject.className + ' redactor_dropdown_' + btnName + '">' + btnObject.title + '</a>');
					$item.on('click', $.proxy(function(e)
					{
						if (e.preventDefault) e.preventDefault();
						if (this.browser('msie')) e.returnValue = false;

						if (btnObject.callback) btnObject.callback.call(this, btnName, $item, btnObject, e);
						if (btnObject.exec) this.execCommand(btnObject.exec, btnName);
						if (btnObject.func) this[btnObject.func](btnName);

						this.buttonActiveObserver();
						if (this.opts.air) this.$air.fadeOut(100);

					}, this));
				}

				$dropdown.append($item);

			}, this));
		},
		dropdownShow: function(e, key)
		{
			if (!this.opts.visual)
			{
				e.preventDefault();
				return false;
			}

			var $button = this.buttonGet(key);

			// Always re-append it to the end of <body> so it always has the highest sub-z-index.
			var $dropdown  = $button.data('dropdown').appendTo(document.body);

			if ($button.hasClass('dropact')) this.dropdownHideAll();
			else
			{
				this.dropdownHideAll();
				this.callback('dropdownShow', { dropdown: $dropdown, key: key, button: $button });

				this.buttonActive(key);
				$button.addClass('dropact');

				var keyPosition = $button.offset();

				// fix right placement
				var dropdownWidth = $dropdown.width();
				if ((keyPosition.left + dropdownWidth) > $(document).width())
				{
					keyPosition.left -= dropdownWidth;
				}

				var left = keyPosition.left + 'px';
				var btnHeight = $button.innerHeight();

				var position = 'absolute';
				var top = (btnHeight + this.opts.toolbarFixedTopOffset) + 'px';

				if (this.opts.toolbarFixed && this.toolbarFixed) position = 'fixed';
				else top = keyPosition.top + btnHeight + 'px';

				$dropdown.css({ position: position, left: left, top: top }).show();
				this.callback('dropdownShown', { dropdown: $dropdown, key: key, button: $button });
			}


			var hdlHideDropDown = $.proxy(function(e)
			{

				this.dropdownHide(e, $dropdown);

			}, this);

			$(document).one('click', hdlHideDropDown);
			this.$editor.one('click', hdlHideDropDown);
			this.$editor.one('touchstart', hdlHideDropDown);


			e.stopPropagation();
			this.focusWithSaveScroll();
		},
		dropdownHideAll: function()
		{
			this.$toolbar.find('a.dropact').removeClass('redactor_act').removeClass('dropact');
			$('.redactor_dropdown').hide();
			this.callback('dropdownHide');
		},
		dropdownHide: function (e, $dropdown)
		{
			if (!$(e.target).hasClass('dropact'))
			{
				$dropdown.removeClass('dropact');
				this.dropdownHideAll();
			}
		},

		// BUTTONS
		buttonBuild: function(btnName, btnObject, buttonImage)
		{
			var $button = $('<a href="javascript:;" title="' + btnObject.title + '" tabindex="-1" class="re-icon re-' + btnName + '"></a>');

			if (typeof buttonImage != 'undefined')
			{
				$button.addClass('redactor-btn-image');
			}

			$button.on('click', $.proxy(function(e)
			{
				if (e.preventDefault) e.preventDefault();
				if (this.browser('msie')) e.returnValue = false;

				if ($button.hasClass('redactor_button_disabled')) return false;

				if (this.isFocused() === false && !btnObject.exec)
				{
					this.focusWithSaveScroll();
				}

				if (btnObject.exec)
				{
					this.focusWithSaveScroll();

					this.execCommand(btnObject.exec, btnName);
					this.airBindMousemoveHide();

				}
				else if (btnObject.func && btnObject.func !== 'show')
				{
					this[btnObject.func](btnName);
					this.airBindMousemoveHide();

				}
				else if (btnObject.callback)
				{
					btnObject.callback.call(this, btnName, $button, btnObject, e);
					this.airBindMousemoveHide();

				}
				else if (btnObject.dropdown)
				{
					this.dropdownShow(e, btnName);
				}

				this.buttonActiveObserver(false, btnName);

			}, this));

			// dropdown
			if (btnObject.dropdown)
			{
				var $dropdown = $('<div class="redactor_dropdown redactor_dropdown_box_' + btnName + '" style="display: none;">');
				$button.data('dropdown', $dropdown);
				this.dropdownBuild($dropdown, btnObject.dropdown);
			}

			return $button;
		},
		buttonGet: function(key)
		{
			if (!this.opts.toolbar) return false;
			return $(this.$toolbar.find('a.re-' + key));
		},
		buttonTagToActiveState: function(buttonName, tagName)
		{
			this.opts.activeButtons.push(buttonName);
			this.opts.activeButtonsStates[tagName] = buttonName;
		},
		buttonActiveToggle: function(key)
		{
			var btn = this.buttonGet(key);

			if (btn.hasClass('redactor_act'))
			{
				this.buttonInactive(key);
			}
			else
			{
				this.buttonActive(key);
			}
		},
		buttonActive: function(key)
		{
			var btn = this.buttonGet(key);
			btn.addClass('redactor_act');
		},
		buttonInactive: function(key)
		{
			var btn = this.buttonGet(key);
			btn.removeClass('redactor_act');
		},
		buttonInactiveAll: function(btnName)
		{
			this.$toolbar.find('a.re-icon').not('.re-' + btnName).removeClass('redactor_act');
		},
		buttonActiveVisual: function()
		{
			this.$toolbar.find('a.re-icon').not('a.re-html').removeClass('redactor_button_disabled');
		},
		buttonInactiveVisual: function()
		{
			this.$toolbar.find('a.re-icon').not('a.re-html').addClass('redactor_button_disabled');
		},
		buttonChangeIcon: function (key, classname)
		{
			this.buttonGet(key).addClass('re-' + classname);
		},
		buttonRemoveIcon: function(key, classname)
		{
			this.buttonGet(key).removeClass('re-' + classname);
		},
		buttonAwesome: function(key, name)
		{
			var button = this.buttonGet(key);
			button.removeClass('redactor-btn-image');
			button.addClass('fa-redactor-btn');
			button.html('<i class="fa ' + name + '"></i>');
		},
		buttonAdd: function(key, title, callback, dropdown)
		{
			if (!this.opts.toolbar) return;
			var btn = this.buttonBuild(key, { title: title, callback: callback, dropdown: dropdown }, true);

			this.$toolbar.append($('<li>').append(btn));

			return btn;
		},
		buttonAddFirst: function(key, title, callback, dropdown)
		{
			if (!this.opts.toolbar) return;
			var btn = this.buttonBuild(key, { title: title, callback: callback, dropdown: dropdown }, true);
			this.$toolbar.prepend($('<li>').append(btn));
		},
		buttonAddAfter: function(afterkey, key, title, callback, dropdown)
		{
			if (!this.opts.toolbar) return;
			var btn = this.buttonBuild(key, { title: title, callback: callback, dropdown: dropdown }, true);
			var $btn = this.buttonGet(afterkey);

			if ($btn.size() !== 0) $btn.parent().after($('<li>').append(btn));
			else this.$toolbar.append($('<li>').append(btn));

			return btn;
		},
		buttonAddBefore: function(beforekey, key, title, callback, dropdown)
		{
			if (!this.opts.toolbar) return;
			var btn = this.buttonBuild(key, { title: title, callback: callback, dropdown: dropdown }, true);
			var $btn = this.buttonGet(beforekey);

			if ($btn.size() !== 0) $btn.parent().before($('<li>').append(btn));
			else this.$toolbar.append($('<li>').append(btn));

			return btn;
		},
		buttonRemove: function (key)
		{
			var $btn = this.buttonGet(key);
			$btn.remove();
		},
		buttonActiveObserver: function(e, btnName)
		{
			var parent = this.getParent();
			this.buttonInactiveAll(btnName);

			if (e === false && btnName !== 'html')
			{
				if ($.inArray(btnName, this.opts.activeButtons) != -1)
				{
					this.buttonActiveToggle(btnName);
				}
				return;
			}

			if (parent && parent.tagName === 'A') this.$toolbar.find('a.redactor_dropdown_link').text(this.opts.curLang.link_edit);
			else this.$toolbar.find('a.redactor_dropdown_link').text(this.opts.curLang.link_insert);

			$.each(this.opts.activeButtonsStates, $.proxy(function(key, value)
			{
				if ($(parent).closest(key, this.$editor.get()[0]).length != 0)
				{
					this.buttonActive(value);
				}

			}, this));

			var $parent = $(parent).closest(this.opts.alignmentTags.toString().toLowerCase(), this.$editor[0]);
			if ($parent.length)
			{
				var align = $parent.css('text-align');
				if (align == '')
				{
					align = 'left';
				}

				this.buttonActive('align' + align);
			}
		},

		// EXEC
		execPasteFrag: function(html)
		{
			var sel = this.getSelection();
			if (sel.getRangeAt && sel.rangeCount)
			{
				var range = this.getRange();
				range.deleteContents();

				var el = this.document.createElement("div");
				el.innerHTML = html;

				var frag = this.document.createDocumentFragment(), node, lastNode;
				while ((node = el.firstChild))
				{
					lastNode = frag.appendChild(node);
				}

				var firstNode = frag.firstChild;
				range.insertNode(frag);

				if (lastNode)
				{
					range = range.cloneRange();
					range.setStartAfter(lastNode);
					range.collapse(true);
				}
				sel.removeAllRanges();
				sel.addRange(range);
			}
		},
		exec: function(cmd, param, sync)
		{
			if (cmd === 'formatblock' && this.browser('msie'))
			{
				param = '<' + param + '>';
			}

			if (cmd === 'inserthtml' && this.browser('msie'))
			{
				if (!this.isIe11())
				{
					this.focusWithSaveScroll();
					this.document.selection.createRange().pasteHTML(param);
				}
				else this.execPasteFrag(param);
			}
			else
			{
				this.document.execCommand(cmd, false, param);
			}

			if (sync !== false) this.sync();
			this.callback('execCommand', cmd, param);
		},
		execCommand: function(cmd, param, sync)
		{
			if (!this.opts.visual)
			{
				this.$source.focus();
				return false;
			}

			if (   cmd === 'bold'
				|| cmd === 'italic'
				|| cmd === 'underline'
				|| cmd === 'strikethrough')
			{
				this.bufferSet();
			}


			if (cmd === 'superscript' || cmd === 'subscript')
			{
				var parent = this.getParent();
				if (parent.tagName === 'SUP' || parent.tagName === 'SUB')
				{
					this.inlineRemoveFormatReplace(parent);
				}
			}

			if (cmd === 'inserthtml')
			{
				this.insertHtml(param, sync);
				this.callback('execCommand', cmd, param);
				return;
			}

			// Stop formatting pre
			if (this.currentOrParentIs('PRE') && !this.opts.formattingPre) return false;

			// Lists
			if (cmd === 'insertunorderedlist' || cmd === 'insertorderedlist') return this.execLists(cmd, param);

			// Unlink
			if (cmd === 'unlink') return this.execUnlink(cmd, param);

			// Usual exec
			this.exec(cmd, param, sync);

			// Line
			if (cmd === 'inserthorizontalrule') this.$editor.find('hr').removeAttr('id');

		},
		execUnlink: function(cmd, param)
		{
			this.bufferSet();

			var link = this.currentOrParentIs('A');
			if (link)
			{
				$(link).replaceWith($(link).text());

				this.sync();
				this.callback('execCommand', cmd, param);
				return;
			}
		},
		execLists: function(cmd, param)
		{
			this.bufferSet();

			var parent = this.getParent();
			var $list = $(parent).closest('ol, ul');

			if (!this.isParentRedactor($list) && $list.size() != 0)
			{
				$list = false;
			}

			var remove = false;

			if ($list && $list.length)
			{
				remove = true;
				var listTag = $list[0].tagName;
			 	if ((cmd === 'insertunorderedlist' && listTag === 'OL')
			 	|| (cmd === 'insertorderedlist' && listTag === 'UL'))
			 	{
				 	remove = false;
				}
			}

			this.selectionSave();

			// remove lists
			if (remove)
			{

				var nodes = this.getNodes();
				var elems = this.getBlocks(nodes);

				if (typeof nodes[0] != 'undefined' && nodes.length > 1 && nodes[0].nodeType == 3)
				{
					// fix the adding the first li to the array
					elems.unshift(this.getBlock());
				}

				var data = '', replaced = '';
				$.each(elems, $.proxy(function(i,s)
				{
					if (s.tagName == 'LI')
					{
						var $s = $(s);
						var cloned = $s.clone();
						cloned.find('ul', 'ol').remove();

						if (this.opts.linebreaks === false)
						{
							data += this.outerHtml($('<p>').append(cloned.contents()));
						}
						else
						{
							var clonedHtml = cloned.html().replace(/<br\s?\/?>$/i, '');
							data += clonedHtml + '<br>';
						}

						if (i == 0)
						{
							$s.addClass('redactor-replaced').empty();
							replaced = this.outerHtml($s);
						}
						else $s.remove();
					}

				}, this));


				html = this.$editor.html().replace(replaced, '</' + listTag + '>' + data + '<' + listTag + '>');

				this.$editor.html(html);
				this.$editor.find(listTag + ':empty').remove();

			}

			// insert lists
			else
			{
				var firstParent = $(this.getParent()).closest('td');

				if (this.browser('msie') && !this.isIe11() && this.opts.linebreaks)
				{
					var wrapper = this.selectionWrap('div');
					var wrapperHtml = $(wrapper).html();
					var tmpList = $('<ul>');
					if (cmd == 'insertorderedlist')
					{
						tmpList = $('<ol>');
					}

					var tmpLi = $('<li>');

					if ($.trim(wrapperHtml) == '')
					{
						tmpLi.append(wrapperHtml + '<span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>');
						tmpList.append(tmpLi);
						this.$editor.find('#selection-marker-1').replaceWith(tmpList);
					}
					else
					{
						tmpLi.append(wrapperHtml);
						tmpList.append(tmpLi);
						$(wrapper).replaceWith(tmpList);
					}
				}
				else
				{
					this.document.execCommand(cmd);
				}

				var parent = this.getParent();
				var $list = $(parent).closest('ol, ul');

				if (this.opts.linebreaks === false)
				{
					var listText = $.trim($list.text());
					if (listText == '')
					{
						$list.children('li').find('br').remove();
						$list.children('li').append('<span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>');
					}
				}

				if (firstParent.size() != 0)
				{
					$list.wrapAll('<td>');
				}

				if ($list.length)
				{
					// remove block-element list wrapper
					var $listParent = $list.parent();
					if (this.isParentRedactor($listParent) && $listParent[0].tagName != 'LI' && this.nodeTestBlocks($listParent[0]))
					{
						$listParent.replaceWith($listParent.contents());
					}
				}

				if (this.browser('mozilla'))
				{
					this.$editor.focus();
				}
			}

			this.selectionRestore();
			this.$editor.find('#selection-marker-1').removeAttr('id');
			this.sync();
			this.callback('execCommand', cmd, param);
			return;
		},

		// INDENTING
		indentingIndent: function()
		{
			this.indentingStart('indent');
		},
		indentingOutdent: function()
		{
			this.indentingStart('outdent');
		},
		indentingStart: function(cmd)
		{
			this.bufferSet();

			if (cmd === 'indent')
			{
				var block = this.getBlock();

				this.selectionSave();

				if (block && block.tagName == 'LI')
				{
					// li
					var parent = this.getParent();

					var $list = $(parent).closest('ol, ul');
					var listTag = $list[0].tagName;

					var elems = this.getBlocks();

					$.each(elems, function(i,s)
					{
						if (s.tagName == 'LI')
						{
							var $prev = $(s).prev();
							if ($prev.size() != 0 && $prev[0].tagName == 'LI')
							{
								var $childList = $prev.children('ul, ol');
								if ($childList.size() == 0)
								{
									$prev.append($('<' + listTag + '>').append(s));
								}
								else $childList.append(s);
							}
						}
					});
				}
				// linebreaks
				else if (block === false && this.opts.linebreaks === true)
				{
					this.exec('formatBlock', 'blockquote');
					var newblock = this.getBlock();
					var block = $('<div data-tagblock="">').html($(newblock).html());
					$(newblock).replaceWith(block);

					var left = this.normalize($(block).css('margin-left')) + this.opts.indentValue;
					$(block).css('margin-left', left + 'px');
				}
				else
				{
					// all block tags
					var elements = this.getBlocks();
					$.each(elements, $.proxy(function(i, elem)
					{
						var $el = false;

						if (elem.tagName === 'TD') return;

						if ($.inArray(elem.tagName, this.opts.alignmentTags) !== -1)
						{
							$el = $(elem);
						}
						else
						{
							$el = $(elem).closest(this.opts.alignmentTags.toString().toLowerCase(), this.$editor[0]);
						}

						var left = this.normalize($el.css('margin-left')) + this.opts.indentValue;
						$el.css('margin-left', left + 'px');

					}, this));
				}

				this.selectionRestore();

			}
			// outdent
			else
			{
				this.selectionSave();

				var block = this.getBlock();
				if (block && block.tagName == 'LI')
				{
					// li
					var elems = this.getBlocks();
					var index = 0;

					this.insideOutdent(block, index, elems);
				}
				else
				{
					// all block tags
					var elements = this.getBlocks();
					$.each(elements, $.proxy(function(i, elem)
					{
						var $el = false;

						if ($.inArray(elem.tagName, this.opts.alignmentTags) !== -1)
						{
							$el = $(elem);
						}
						else
						{
							$el = $(elem).closest(this.opts.alignmentTags.toString().toLowerCase(), this.$editor[0]);
						}

						var left = this.normalize($el.css('margin-left')) - this.opts.indentValue;
						if (left <= 0)
						{
							// linebreaks
							if (this.opts.linebreaks === true && typeof($el.data('tagblock')) !== 'undefined')
							{
								$el.replaceWith($el.html() + '<br>');
							}
							// all block tags
							else
							{
								$el.css('margin-left', '');
								this.removeEmptyAttr($el, 'style');
							}
						}
						else
						{
							$el.css('margin-left', left + 'px');
						}

					}, this));
				}


				this.selectionRestore();
			}

			this.sync();

		},
		insideOutdent: function (li, index, elems)
		{
			if (li && li.tagName == 'LI')
			{
				var $parent = $(li).parent().parent();
				if ($parent.size() != 0 && $parent[0].tagName == 'LI')
				{
					$parent.after(li);
				}
				else
				{
					if (typeof elems[index] != 'undefined')
					{
						li = elems[index];
						index++;

						this.insideOutdent(li, index, elems);
					}
					else
					{
						this.execCommand('insertunorderedlist');
					}
				}
			}
		},

		// ALIGNMENT
		alignmentLeft: function()
		{
			this.alignmentSet('', 'JustifyLeft');
		},
		alignmentRight: function()
		{
			this.alignmentSet('right', 'JustifyRight');
		},
		alignmentCenter: function()
		{
			this.alignmentSet('center', 'JustifyCenter');
		},
		alignmentJustify: function()
		{
			this.alignmentSet('justify', 'JustifyFull');
		},
		alignmentSet: function(type, cmd)
		{
			this.bufferSet();

			if (this.oldIE())
			{
				this.document.execCommand(cmd, false, false);
				return true;
			}

			this.selectionSave();

			var block = this.getBlock();
			if (!block && this.opts.linebreaks)
			{
				// one element
				this.exec('formatblock', 'div');

				var newblock = this.getBlock();
				var block = $('<div data-tagblock="">').html($(newblock).html());
				$(newblock).replaceWith(block);

				$(block).css('text-align', type);
				this.removeEmptyAttr(block, 'style');

				if (type == '' && typeof($(block).data('tagblock')) !== 'undefined')
				{
					$(block).replaceWith($(block).html());
				}
			}
			else
			{
				var elements = this.getBlocks();
				$.each(elements, $.proxy(function(i, elem)
				{
					var $el = false;

					if ($.inArray(elem.tagName, this.opts.alignmentTags) !== -1)
					{
						$el = $(elem);
					}
					else
					{
						$el = $(elem).closest(this.opts.alignmentTags.toString().toLowerCase(), this.$editor[0]);
					}

					if ($el)
					{
						$el.css('text-align', type);
						this.removeEmptyAttr($el, 'style');
					}

				}, this));
			}

			this.selectionRestore();
			this.sync();
		},

		// CLEAN
		cleanEmpty: function(html)
		{
			var ph = this.placeholderStart(html);
			if (ph !== false) return ph;

			if (this.opts.linebreaks === false)
			{
				if (html === '') html = this.opts.emptyHtml;
				else if (html.search(/^<hr\s?\/?>$/gi) !== -1) html = '<hr>' + this.opts.emptyHtml;
			}

			return html;
		},
		cleanConverters: function(html)
		{
			// convert div to p
			if (this.opts.convertDivs && !this.opts.gallery)
			{
				html = html.replace(/<div(.*?)>([\w\W]*?)<\/div>/gi, '<p$1>$2</p>');
			}

			if (this.opts.paragraphy) html = this.cleanParagraphy(html);

			return html;
		},
		cleanConvertProtected: function(html)
		{
			if (this.opts.templateVars)
			{
				html = html.replace(/\{\{(.*?)\}\}/gi, '<!-- template double $1 -->');
				html = html.replace(/\{(.*?)\}/gi, '<!-- template $1 -->');
			}

			html = html.replace(/<script(.*?)>([\w\W]*?)<\/script>/gi, '<title type="text/javascript" style="display: none;" class="redactor-script-tag"$1>$2</title>');
			html = html.replace(/<style(.*?)>([\w\W]*?)<\/style>/gi, '<section$1 style="display: none;" rel="redactor-style-tag">$2</section>');
			html = html.replace(/<form(.*?)>([\w\W]*?)<\/form>/gi, '<section$1 rel="redactor-form-tag">$2</section>');

			// php tags convertation
			if (this.opts.phpTags) html = html.replace(/<\?php([\w\W]*?)\?>/gi, '<section style="display: none;" rel="redactor-php-tag">$1</section>');
			else html = html.replace(/<\?php([\w\W]*?)\?>/gi, '');

			return html;
		},
		cleanReConvertProtected: function(html)
		{
			if (this.opts.templateVars)
			{
				html = html.replace(/<!-- template double (.*?) -->/gi, '{{$1}}');
				html = html.replace(/<!-- template (.*?) -->/gi, '{$1}');
			}

			html = html.replace(/<title type="text\/javascript" style="display: none;" class="redactor-script-tag"(.*?)>([\w\W]*?)<\/title>/gi, '<script$1 type="text/javascript">$2</script>');
			html = html.replace(/<section(.*?) style="display: none;" rel="redactor-style-tag">([\w\W]*?)<\/section>/gi, '<style$1>$2</style>');
			html = html.replace(/<section(.*?)rel="redactor-form-tag"(.*?)>([\w\W]*?)<\/section>/gi, '<form$1$2>$3</form>');

			// php tags convertation
			if (this.opts.phpTags) html = html.replace(/<section style="display: none;" rel="redactor-php-tag">([\w\W]*?)<\/section>/gi, '<?php\r\n$1\r\n?>');

			return html;
		},
		cleanRemoveSpaces: function(html, buffer)
		{
			if (buffer !== false)
			{
				var buffer = []
				var matches = html.match(/<(pre|style|script|title)(.*?)>([\w\W]*?)<\/(pre|style|script|title)>/gi);
				if (matches === null) matches = [];

				if (this.opts.phpTags)
				{
					var phpMatches = html.match(/<\?php([\w\W]*?)\?>/gi);
					if (phpMatches) matches = $.merge(matches, phpMatches);
				}

				if (matches)
				{
					$.each(matches, function(i, s)
					{
						html = html.replace(s, 'buffer_' + i);
						buffer.push(s);
					});
				}
			}

			html = html.replace(/\n/g, ' ');
			html = html.replace(/[\t]*/g, '');
			html = html.replace(/\n\s*\n/g, "\n");
			html = html.replace(/^[\s\n]*/g, ' ');
			html = html.replace(/[\s\n]*$/g, ' ');
			html = html.replace( />\s{2,}</g, '> <'); // between inline tags can be only one space

			html = this.cleanReplacer(html, buffer);

			html = html.replace(/\n\n/g, "\n");

			return html;
		},
		cleanReplacer: function(html, buffer)
		{
			if (buffer === false) return html;

			$.each(buffer, function(i,s)
			{
				html = html.replace('buffer_' + i, s);
			});

			return html;
		},
		cleanRemoveEmptyTags: function(html)
		{
			// remove zero width-space
			html = html.replace(/[\u200B-\u200D\uFEFF]/g, '');

			var etagsInline = ["<b>\\s*</b>", "<b>&nbsp;</b>", "<em>\\s*</em>"]
			var etags = ["<pre></pre>", "<blockquote>\\s*</blockquote>", "<dd></dd>", "<dt></dt>", "<ul></ul>", "<ol></ol>", "<li></li>", "<table></table>", "<tr></tr>", "<span>\\s*<span>", "<span>&nbsp;<span>", "<p>\\s*</p>", "<p></p>", "<p>&nbsp;</p>",  "<p>\\s*<br>\\s*</p>", "<div>\\s*</div>", "<div>\\s*<br>\\s*</div>"];

			if (this.opts.removeEmptyTags)
			{
				etags = etags.concat(etagsInline);
			}
			else etags = etagsInline;

			var len = etags.length;
			for (var i = 0; i < len; ++i)
			{
				html = html.replace(new RegExp(etags[i], 'gi'), "");
			}

			return html;
		},
		cleanParagraphy: function(html)
		{
			html = $.trim(html);

			if (this.opts.linebreaks === true) return html;
			if (html === '' || html === '<p></p>') return this.opts.emptyHtml;

			html = html + "\n";

			if (this.opts.removeEmptyTags === false)
			{
				return html;
			}

			var safes = [];
			var matches = html.match(/<(table|div|pre|object)(.*?)>([\w\W]*?)<\/(table|div|pre|object)>/gi);
			if (!matches) matches = [];

			var commentsMatches = html.match(/<!--([\w\W]*?)-->/gi);
			if (commentsMatches) matches = $.merge(matches, commentsMatches);

			if (this.opts.phpTags)
			{
				var phpMatches = html.match(/<section(.*?)rel="redactor-php-tag">([\w\W]*?)<\/section>/gi);
				if (phpMatches) matches = $.merge(matches, phpMatches);
			}

			if (matches)
			{
				$.each(matches, function(i,s)
				{
					safes[i] = s;
					html = html.replace(s, '{replace' + i + '}\n');
				});
			}

			html = html.replace(/<br \/>\s*<br \/>/gi, "\n\n");
			html = html.replace(/<br><br>/gi, "\n\n");

			function R(str, mod, r)
			{
				return html.replace(new RegExp(str, mod), r);
			}

			var blocks = '(comment|html|body|head|title|meta|style|script|link|iframe|table|thead|tfoot|caption|col|colgroup|tbody|tr|td|th|div|dl|dd|dt|ul|ol|li|pre|select|option|form|map|area|blockquote|address|math|style|p|h[1-6]|hr|fieldset|legend|section|article|aside|hgroup|header|footer|nav|figure|figcaption|details|menu|summary)';

			html = R('(<' + blocks + '[^>]*>)', 'gi', "\n$1");
			html = R('(</' + blocks + '>)', 'gi', "$1\n\n");
			html = R("\r\n", 'g', "\n");
			html = R("\r", 'g', "\n");
			html = R("/\n\n+/", 'g', "\n\n");

			var htmls = html.split(new RegExp('\n\s*\n', 'g'), -1);

			html = '';
			for (var i in htmls)
			{
				if (htmls.hasOwnProperty(i))
                {
					if (htmls[i].search('{replace') == -1)
					{
						htmls[i] = htmls[i].replace(/<p>\n\t?<\/p>/gi, '');
						htmls[i] = htmls[i].replace(/<p><\/p>/gi, '');

						if (htmls[i] != '')
						{
							html += '<p>' +  htmls[i].replace(/^\n+|\n+$/g, "") + "</p>";
						}
					}
					else html += htmls[i];
				}
			}

			html = R('<p><p>', 'gi', '<p>');
			html = R('</p></p>', 'gi', '</p>');

			html = R('<p>\s?</p>', 'gi', '');

			html = R('<p>([^<]+)</(div|address|form)>', 'gi', "<p>$1</p></$2>");

			html = R('<p>(</?' + blocks + '[^>]*>)</p>', 'gi', "$1");
			html = R("<p>(<li.+?)</p>", 'gi', "$1");
			html = R('<p>\s?(</?' + blocks + '[^>]*>)', 'gi', "$1");

			html = R('(</?' + blocks + '[^>]*>)\s?</p>', 'gi', "$1");
			html = R('(</?' + blocks + '[^>]*>)\s?<br />', 'gi', "$1");
			html = R('<br />(\s*</?(?:p|li|div|dl|dd|dt|th|pre|td|ul|ol)[^>]*>)', 'gi', '$1');
			html = R("\n</p>", 'gi', '</p>');

			html = R('<li><p>', 'gi', '<li>');
			html = R('</p></li>', 'gi', '</li>');
			html = R('</li><p>', 'gi', '</li>');
			//html = R('</ul><p>(.*?)</li>', 'gi', '</ul></li>');
			// html = R('</ol><p>', 'gi', '</ol>');
			html = R('<p>\t?\n?<p>', 'gi', '<p>');
			html = R('</dt><p>', 'gi', '</dt>');
			html = R('</dd><p>', 'gi', '</dd>');
			html = R('<br></p></blockquote>', 'gi', '</blockquote>');
			html = R('<p>\t*</p>', 'gi', '');

			// restore safes
			$.each(safes, function(i,s)
			{
				html = html.replace('{replace' + i + '}', s);
			});

			return $.trim(html);
		},
		cleanConvertInlineTags: function(html, set)
		{
			var boldTag = 'strong';
			if (this.opts.boldTag === 'b') boldTag = 'b';

			var italicTag = 'em';
			if (this.opts.italicTag === 'i') italicTag = 'i';

			html = html.replace(/<span style="font-style: italic;">([\w\W]*?)<\/span>/gi, '<' + italicTag + '>$1</' + italicTag + '>');
			html = html.replace(/<span style="font-weight: bold;">([\w\W]*?)<\/span>/gi, '<' + boldTag + '>$1</' + boldTag + '>');

			// bold, italic, del
			if (this.opts.boldTag === 'strong') html = html.replace(/<b>([\w\W]*?)<\/b>/gi, '<strong>$1</strong>');
			else html = html.replace(/<strong>([\w\W]*?)<\/strong>/gi, '<b>$1</b>');

			if (this.opts.italicTag === 'em') html = html.replace(/<i>([\w\W]*?)<\/i>/gi, '<em>$1</em>');
			else html = html.replace(/<em>([\w\W]*?)<\/em>/gi, '<i>$1</i>');

			html = html.replace(/<span style="text-decoration: underline;">([\w\W]*?)<\/span>/gi, '<u>$1</u>');

			if (set !== true) html = html.replace(/<strike>([\w\W]*?)<\/strike>/gi, '<del>$1</del>');
			else html = html.replace(/<del>([\w\W]*?)<\/del>/gi, '<strike>$1</strike>');

			return html;
		},
		cleanStripTags: function(html)
		{
			if (html == '' || typeof html == 'undefined') return html;

			var allowed = false;
			if (this.opts.allowedTags !== false) allowed = true;

			var arr = allowed === true ? this.opts.allowedTags : this.opts.deniedTags;

			var tags = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
			html = html.replace(tags, function ($0, $1)
			{
				if (allowed === true) return $.inArray($1.toLowerCase(), arr) > '-1' ? $0 : '';
				else return $.inArray($1.toLowerCase(), arr) > '-1' ? '' : $0;
			});

			html = this.cleanConvertInlineTags(html);

			return html;

		},
		cleanSavePreCode: function(html, encode)
		{
			var pre = html.match(/<(pre|code)(.*?)>([\w\W]*?)<\/(pre|code)>/gi);
			if (pre !== null)
			{
				$.each(pre, $.proxy(function(i,s)
				{
					var arr = s.match(/<(pre|code)(.*?)>([\w\W]*?)<\/(pre|code)>/i);

					arr[3] = arr[3].replace(/&nbsp;/g, ' ');

					if (encode !== false) arr[3] = this.cleanEncodeEntities(arr[3]);

					// $ fix
					arr[3] = arr[3].replace(/\$/g, '&#36;');

					html = html.replace(s, '<' + arr[1] + arr[2] + '>' + arr[3] + '</' + arr[1] + '>');

				}, this));
			}

			return html;
		},
		cleanEncodeEntities: function(str)
		{
			str = String(str).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
			return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
		},
		cleanUnverified: function()
		{
			// label, abbr, mark, meter, code, q, dfn, ins, time, kbd, var
			var $elem = this.$editor.find('li, img, a, b, strong, sub, sup, i, em, u, small, strike, del, span, cite');

			$elem.filter('[style*="background-color: transparent;"][style*="line-height"]')
			.css('background-color', '')
			.css('line-height', '');

			$elem.filter('[style*="background-color: transparent;"]')
			.css('background-color', '');

			$elem.css('line-height', '');

			$.each($elem, $.proxy(function(i,s)
			{
				this.removeEmptyAttr(s, 'style');
			}, this));

			var $elem2 = this.$editor.find('b, strong, i, em, u, strike, del');
			$elem2.css('font-size', '');

			$.each($elem2, $.proxy(function(i,s)
			{
				this.removeEmptyAttr(s, 'style');
			}, this));

			// When we paste text in Safari is wrapping inserted div (remove it)
			this.$editor.find('div[style="text-align: -webkit-auto;"]').contents().unwrap();

			// Remove all styles in ul, ol, li
			this.$editor.find('ul, ol, li').removeAttr('style');
		},


		// TEXTAREA CODE FORMATTING
		cleanHtml: function(code)
		{
			var i = 0,
			codeLength = code.length,
			point = 0,
			start = null,
			end = null,
			tag = '',
			out = '',
			cont = '';

			this.cleanlevel = 0;

			for (; i < codeLength; i++)
			{
				point = i;

				// if no more tags, copy and exit
				if (-1 == code.substr(i).indexOf( '<' ))
				{
					out += code.substr(i);

					return this.cleanFinish(out);
				}

				// copy verbatim until a tag
				while (point < codeLength && code.charAt(point) != '<')
				{
					point++;
				}

				if (i != point)
				{
					cont = code.substr(i, point - i);
					if (!cont.match(/^\s{2,}$/g))
					{
						if ('\n' == out.charAt(out.length - 1)) out += this.cleanGetTabs();
						else if ('\n' == cont.charAt(0))
						{
							out += '\n' + this.cleanGetTabs();
							cont = cont.replace(/^\s+/, '');
						}

						out += cont;
					}

					if (cont.match(/\n/)) out += '\n' + this.cleanGetTabs();
				}

				start = point;

				// find the end of the tag
				while (point < codeLength && '>' != code.charAt(point))
				{
					point++;
				}

				tag = code.substr(start, point - start);
				i = point;

				var t;

				if ('!--' == tag.substr(1, 3))
				{
					if (!tag.match(/--$/))
					{
						while ('-->' != code.substr(point, 3))
						{
							point++;
						}
						point += 2;
						tag = code.substr(start, point - start);
						i = point;
					}

					if ('\n' != out.charAt(out.length - 1)) out += '\n';

					out += this.cleanGetTabs();
					out += tag + '>\n';
				}
				else if ('!' == tag[1])
				{
					out = this.placeTag(tag + '>', out);
				}
				else if ('?' == tag[1])
				{
					out += tag + '>\n';
				}
				else if (t = tag.match(/^<(script|style|pre)/i))
				{
					t[1] = t[1].toLowerCase();
					tag = this.cleanTag(tag);
					out = this.placeTag(tag, out);
					end = String(code.substr(i + 1)).toLowerCase().indexOf('</' + t[1]);

					if (end)
					{
						cont = code.substr(i + 1, end);
						i += end;
						out += cont;
					}
				}
				else
				{
					tag = this.cleanTag(tag);
					out = this.placeTag(tag, out);
				}
			}

			return this.cleanFinish(out);
		},
		cleanGetTabs: function()
		{
			var s = '';
			for ( var j = 0; j < this.cleanlevel; j++ )
			{
				s += '\t';
			}

			return s;
		},
		cleanFinish: function(code)
		{
			code = code.replace(/\n\s*\n/g, '\n');
			code = code.replace(/^[\s\n]*/, '');
			code = code.replace(/[\s\n]*$/, '');
			code = code.replace(/<script(.*?)>\n<\/script>/gi, '<script$1></script>');

			this.cleanlevel = 0;

			return code;
		},
		cleanTag: function (tag)
		{
			var tagout = '';
			tag = tag.replace(/\n/g, ' ');
			tag = tag.replace(/\s{2,}/g, ' ');
			tag = tag.replace(/^\s+|\s+$/g, ' ');

			var suffix = '';
			if (tag.match(/\/$/))
			{
				suffix = '/';
				tag = tag.replace(/\/+$/, '');
			}

			var m;
			while (m = /\s*([^= ]+)(?:=((['"']).*?\3|[^ ]+))?/.exec(tag))
			{
				if (m[2]) tagout += m[1].toLowerCase() + '=' + m[2];
				else if (m[1]) tagout += m[1].toLowerCase();

				tagout += ' ';
				tag = tag.substr(m[0].length);
			}

			return tagout.replace(/\s*$/, '') + suffix + '>';
		},
		placeTag: function (tag, out)
		{
			var nl = tag.match(this.cleannewLevel);
			if (tag.match(this.cleanlineBefore) || nl)
			{
				out = out.replace(/\s*$/, '');
				out += '\n';
			}

			if (nl && '/' == tag.charAt(1)) this.cleanlevel--;
			if ('\n' == out.charAt(out.length - 1)) out += this.cleanGetTabs();
			if (nl && '/' != tag.charAt(1)) this.cleanlevel++;

			out += tag;

			if (tag.match(this.cleanlineAfter) || tag.match(this.cleannewLevel))
			{
				out = out.replace(/ *$/, '');
				out += '\n';
			}

			return out;
		},

		// FORMAT
		formatEmpty: function(e)
		{
			var html = $.trim(this.$editor.html());

			if (this.opts.linebreaks)
			{
				if (html == '')
				{
					e.preventDefault();
					this.$editor.html('');
					this.focus();
				}
			}
			else
			{
				html = html.replace(/<br\s?\/?>/i, '');
				var thtml = html.replace(/<p>\s?<\/p>/gi, '');

				if (html === '' || thtml === '')
				{
					e.preventDefault();

					var node = $(this.opts.emptyHtml).get(0);
					this.$editor.html(node);
					this.focus();
				}
			}

			this.sync();
		},
		formatBlocks: function(tag)
		{
			if (this.browser('mozilla') && this.isFocused())
			{
				this.$editor.focus();
			}

			this.bufferSet();

			var nodes = this.getBlocks();
			this.selectionSave();

			$.each(nodes, $.proxy(function(i, node)
			{
				if (node.tagName !== 'LI')
				{
					var parent = $(node).parent();

					if (tag === 'p')
					{
						if ((node.tagName === 'P'
						&& parent.size() != 0
						&& parent[0].tagName === 'BLOCKQUOTE')
						||
						node.tagName === 'BLOCKQUOTE')
						{
							this.formatQuote();
							return;
						}
						else if (this.opts.linebreaks)
						{
							if (node && node.tagName.search(/H[1-6]/) == 0)
							{
								$(node).replaceWith(node.innerHTML + '<br>');
							}
							else return;
						}
						else
						{
							this.formatBlock(tag, node);
						}
					}
					else
					{
						this.formatBlock(tag, node);
					}
				}

			}, this));

			this.selectionRestore();
			this.sync();
		},
		formatBlock: function(tag, block)
		{
			if (block === false) block = this.getBlock();
			if (block === false && this.opts.linebreaks === true)
			{
				this.execCommand('formatblock', tag);
				return true;
			}

			var contents = '';
			if (tag !== 'pre')
			{
				contents = $(block).contents();
			}
			else
			{
				//contents = this.cleanEncodeEntities($(block).text());
				contents = $(block).html();
				if ($.trim(contents) === '')
				{
					contents = '<span id="selection-marker-1"></span>';
				}
			}

			if (block.tagName === 'PRE') tag = 'p';

			if (this.opts.linebreaks === true && tag === 'p')
			{
				$(block).replaceWith($('<div>').append(contents).html() + '<br>');
			}
			else
			{
				var parent = this.getParent();

				var node = $('<' + tag + '>').append(contents);
				$(block).replaceWith(node);

				if (parent && parent.tagName == 'TD')
				{
					$(node).wrapAll('<td>');
				}
			}
		},
		formatChangeTag: function(fromElement, toTagName, save)
		{
			if (save !== false) this.selectionSave();

			var newElement = $('<' + toTagName + '/>');
			$(fromElement).replaceWith(function() { return newElement.append($(this).contents()); });

			if (save !== false) this.selectionRestore();

			return newElement;
		},

		// QUOTE
		formatQuote: function()
		{
			if (this.browser('mozilla') && this.isFocused())
			{
				this.$editor.focus();
			}

			this.bufferSet();

			// paragraphy
			if (this.opts.linebreaks === false)
			{
				this.selectionSave();

				var blocks = this.getBlocks();

				var blockquote = false;
				var blocksLen = blocks.length;
				if (blocks)
				{
					var data = '';
					var replaced = '';
					var replace = false;
					var paragraphsOnly = true;

					$.each(blocks, function(i,s)
					{
						if (s.tagName !== 'P') paragraphsOnly = false;
					});

					$.each(blocks, $.proxy(function(i,s)
					{
						if (s.tagName === 'BLOCKQUOTE')
						{
							this.formatBlock('p', s, false);
						}
						else if (s.tagName === 'P')
						{
							blockquote = $(s).parent();
							// from blockquote
							if (blockquote[0].tagName == 'BLOCKQUOTE')
							{
								var count = $(blockquote).children('p').size();

								// one
								if (count == 1)
								{
									$(blockquote).replaceWith(s);
								}
								// all
								else if (count == blocksLen)
								{
									replace = 'blockquote';
									data += this.outerHtml(s);
								}
								// some
								else
								{
									replace = 'html';
									data += this.outerHtml(s);

									if (i == 0)
									{
										$(s).addClass('redactor-replaced').empty();
										replaced = this.outerHtml(s);
									}
									else $(s).remove();
								}
							}
							// to blockquote
							else
							{
								if (paragraphsOnly === false || blocks.length == 1)
								{
									this.formatBlock('blockquote', s, false);
								}
								else
								{
									replace = 'paragraphs';
									data += this.outerHtml(s);
								}
							}

						}
						else if (s.tagName !== 'LI')
						{
							this.formatBlock('blockquote', s, false);
						}

					}, this));

					if (replace)
					{
						if (replace == 'paragraphs')
						{
							$(blocks[0]).replaceWith('<blockquote>' + data + '</blockquote>');
							$(blocks).remove();
						}
						else if (replace == 'blockquote')
						{
							$(blockquote).replaceWith(data);
						}
						else if (replace == 'html')
						{
							var html = this.$editor.html().replace(replaced, '</blockquote>' + data + '<blockquote>');

							this.$editor.html(html);
							this.$editor.find('blockquote').each(function()
							{
								if ($.trim($(this).html()) == '') $(this).remove();
							})
						}
					}
				}

				this.selectionRestore();
			}
			// linebreaks
			else
			{
				var block = this.getBlock();
				if (block.tagName === 'BLOCKQUOTE')
				{
					this.selectionSave();

					var html = $.trim($(block).html());
					var selection = $.trim(this.getSelectionHtml());

					html = html.replace(/<span(.*?)id="selection-marker(.*?)<\/span>/gi, '');

					if (html == selection)
					{
						$(block).replaceWith($(block).html() + '<br>');
					}
					else
					{
						// replace
						this.inlineFormat('tmp');
						var tmp = this.$editor.find('tmp');
						tmp.empty();

						var newhtml = this.$editor.html().replace('<tmp></tmp>', '</blockquote><span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>' + selection + '<blockquote>');

						this.$editor.html(newhtml);
						tmp.remove();
						this.$editor.find('blockquote').each(function()
						{
							if ($.trim($(this).html()) == '') $(this).remove();
						})
					}

					this.selectionRestore();
					this.$editor.find('span#selection-marker-1').attr('id', false);
				}
				else
				{
					var wrapper = this.selectionWrap('blockquote');
					var html = $(wrapper).html();

					var blocksElemsRemove = ['ul', 'ol', 'table', 'tr', 'tbody', 'thead', 'tfoot', 'dl'];
					$.each(blocksElemsRemove, function(i,s)
					{
						html = html.replace(new RegExp('<' + s + '(.*?)>', 'gi'), '');
						html = html.replace(new RegExp('</' + s + '>', 'gi'), '');
					});

					var blocksElems = this.opts.blockLevelElements;
					$.each(blocksElems, function(i,s)
					{
						html = html.replace(new RegExp('<' + s + '(.*?)>', 'gi'), '');
						html = html.replace(new RegExp('</' + s + '>', 'gi'), '<br>');
					});

					$(wrapper).html(html);
					this.selectionElement(wrapper);
					var next = $(wrapper).next();
					if (next.size() != 0 && next[0].tagName === 'BR')
					{
						next.remove();
					}
				}
			}

			this.sync();
		},

		// BLOCK
		blockRemoveAttr: function(attr, value)
		{
			var nodes = this.getBlocks();
			$(nodes).removeAttr(attr);

			this.sync();
		},
		blockSetAttr: function(attr, value)
		{
			var nodes = this.getBlocks();
			$(nodes).attr(attr, value);

			this.sync();
		},
		blockRemoveStyle: function(rule)
		{
			var nodes = this.getBlocks();
			$(nodes).css(rule, '');
			this.removeEmptyAttr(nodes, 'style');

			this.sync();
		},
		blockSetStyle: function (rule, value)
		{
			var nodes = this.getBlocks();
			$(nodes).css(rule, value);

			this.sync();
		},
		blockRemoveClass: function(className)
		{
			var nodes = this.getBlocks();
			$(nodes).removeClass(className);
			this.removeEmptyAttr(nodes, 'class');

			this.sync();
		},
		blockSetClass: function(className)
		{
			var nodes = this.getBlocks();
			$(nodes).addClass(className);

			this.sync();
		},

		// INLINE
		inlineRemoveClass: function(className)
		{
			this.selectionSave();

			this.inlineEachNodes(function(node)
			{
				$(node).removeClass(className);
				this.removeEmptyAttr(node, 'class');
			});

			this.selectionRestore();
			this.sync();
		},
		inlineSetClass: function(className)
		{
			var current = this.getCurrent();
			if (!$(current).hasClass(className)) this.inlineMethods('addClass', className);
		},
		inlineRemoveStyle: function (rule)
		{
			this.selectionSave();

			this.inlineEachNodes(function(node)
			{
				$(node).css(rule, '');
				this.removeEmptyAttr(node, 'style');
			});

			this.selectionRestore();
			this.sync();
		},
		inlineSetStyle: function(rule, value)
		{
			this.inlineMethods('css', rule, value);
		},
		inlineRemoveAttr: function (attr)
		{
			this.selectionSave();

			var range = this.getRange(), node = this.getElement(), nodes = this.getNodes();

			if (range.collapsed || range.startContainer === range.endContainer && node)
			{
				nodes = $( node );
			}

			$(nodes).removeAttr(attr);

			this.inlineUnwrapSpan();

			this.selectionRestore();
			this.sync();
		},
		inlineSetAttr: function(attr, value)
		{
			this.inlineMethods('attr', attr, value );
		},
		inlineMethods: function(type, attr, value)
		{
			this.bufferSet();
			this.selectionSave();

			var range = this.getRange()
			var el = this.getElement();

			if ((range.collapsed || range.startContainer === range.endContainer) && el && !this.nodeTestBlocks(el))
			{
				$(el)[type](attr, value);
			}
			else
			{
				var cmd, arg = value;
				switch (attr)
				{
					case 'font-size':
						cmd = 'fontSize';
						arg = 4;
					break;
					case 'font-family':
						cmd = 'fontName';
					break;
					case 'color':
						cmd = 'foreColor';
					break;
					case 'background-color':
						cmd = 'backColor';
					break;
				}

				this.document.execCommand(cmd, false, arg);

				var fonts = this.$editor.find('font');
				$.each(fonts, $.proxy(function(i, s)
				{
					this.inlineSetMethods(type, s, attr, value);

				}, this));

			}

			this.selectionRestore();
			this.sync();
		},
		inlineSetMethods: function(type, s, attr, value)
		{
			var parent = $(s).parent(), el;

			var selectionHtml = this.getSelectionText();
			var parentHtml = $(parent).text();
			var selected = selectionHtml == parentHtml;

			if (selected && parent && parent[0].tagName === 'INLINE' && parent[0].attributes.length != 0)
			{
				el = parent;
				$(s).replaceWith($(s).html());
			}
			else
			{
				el = $('<inline>').append($(s).contents());
				$(s).replaceWith(el);
			}


			$(el)[type](attr, value);

			return el;
		},
		// Sort elements and execute callback
		inlineEachNodes: function(callback)
		{
			var range = this.getRange(),
				node = this.getElement(),
				nodes = this.getNodes(),
				collapsed;

			if (range.collapsed || range.startContainer === range.endContainer && node)
			{
				nodes = $(node);
				collapsed = true;
			}

			$.each(nodes, $.proxy(function(i, node)
			{
				if (!collapsed && node.tagName !== 'INLINE')
				{
					var selectionHtml = this.getSelectionText();
					var parentHtml = $(node).parent().text();
					var selected = selectionHtml == parentHtml;

					if (selected && node.parentNode.tagName === 'INLINE' && !$(node.parentNode).hasClass('redactor_editor'))
					{
						node = node.parentNode;
					}
					else return;
				}
				callback.call(this, node);

			}, this ) );
		},
		inlineUnwrapSpan: function()
		{
			var $spans = this.$editor.find('inline');

			$.each($spans, $.proxy(function(i, span)
			{
				var $span = $(span);

				if ($span.attr('class') === undefined && $span.attr('style') === undefined)
				{
					$span.contents().unwrap();
				}

			}, this));
		},
		inlineFormat: function(tag)
		{
			this.selectionSave();

			this.document.execCommand('fontSize', false, 4 );

			var fonts = this.$editor.find('font');
			var last;
			$.each(fonts, function(i, s)
			{
				var el = $('<' + tag + '/>').append($(s).contents());
				$(s).replaceWith(el);
				last = el;
			});

			this.selectionRestore();

			this.sync();
		},
		inlineRemoveFormat: function(tag)
		{
			this.selectionSave();

			var utag = tag.toUpperCase();
			var nodes = this.getNodes();
			var parent = $(this.getParent()).parent();

			$.each(nodes, function(i, s)
			{
				if (s.tagName === utag) this.inlineRemoveFormatReplace(s);
			});

			if (parent && parent[0].tagName === utag) this.inlineRemoveFormatReplace(parent);

			this.selectionRestore();
			this.sync();
		},
		inlineRemoveFormatReplace: function(el)
		{
			$(el).replaceWith($(el).contents());
		},


		// INSERT
		insertHtml: function (html, sync)
		{
			var current = this.getCurrent();
			var parent = current.parentNode;

			this.focusWithSaveScroll();

			this.bufferSet();

			var $html = $('<div>').append($.parseHTML(html));
			html = $html.html();

			html = this.cleanRemoveEmptyTags(html);

			// Update value
			$html = $('<div>').append($.parseHTML(html));
			var currBlock = this.getBlock();

			if ($html.contents().length == 1)
			{
				var htmlTagName = $html.contents()[0].tagName;

				// If the inserted and received text tags match
				if (htmlTagName != 'P' && htmlTagName == currBlock.tagName || htmlTagName == 'PRE')
				{
					//html = $html.html();
					$html = $('<div>').append(html);
				}
			}

			if (this.opts.linebreaks)
			{
				html = html.replace(/<p(.*?)>([\w\W]*?)<\/p>/gi, '$2<br>');
			}

			// add text in a paragraph
			if (!this.opts.linebreaks && $html.contents().length == 1 && $html.contents()[0].nodeType == 3
				&& (this.getRangeSelectedNodes().length > 2 || (!current || current.tagName == 'BODY' && !parent || parent.tagName == 'HTML')))
			{
				html = '<p>' + html + '</p>';
			}

			html = this.setSpansVerifiedHtml(html);

			if ($html.contents().length > 1 && currBlock
			|| $html.contents().is('p, :header, ul, ol, li, div, table, td, blockquote, pre, address, section, header, footer, aside, article'))
			{
				if (this.browser('msie'))
				{
					if (!this.isIe11())
					{
						this.document.selection.createRange().pasteHTML(html);
					}
					else
					{
						this.execPasteFrag(html);
					}
				}
				else
				{
					this.document.execCommand('inserthtml', false, html);
				}
			}
			else this.insertHtmlAdvanced(html, false);

			if (this.selectall)
			{
				this.window.setTimeout($.proxy(function()
				{
					if (!this.opts.linebreaks) this.selectionEnd(this.$editor.contents().last());
					else this.focusEnd();

				}, this), 1);
			}

			this.observeStart();

			// set no editable
			this.setNonEditable();

			if (sync !== false) this.sync();
		},
		insertHtmlAdvanced: function(html, sync)
		{
			html = this.setSpansVerifiedHtml(html);

			var sel = this.getSelection();

			if (sel.getRangeAt && sel.rangeCount)
			{
				var range = sel.getRangeAt(0);
				range.deleteContents();

				var el = this.document.createElement('div');
				el.innerHTML = html;
				var frag = this.document.createDocumentFragment(), node, lastNode;
				while ((node = el.firstChild))
				{
					lastNode = frag.appendChild(node);
				}

				range.insertNode(frag);

				if (lastNode)
				{
					range = range.cloneRange();
					range.setStartAfter(lastNode);
					range.collapse(true);
					sel.removeAllRanges();
					sel.addRange(range);
				}
			}

			if (sync !== false)
			{
				this.sync();
			}

		},
		insertBeforeCursor: function(html)
		{
			html = this.setSpansVerifiedHtml(html);

			var node = $(html);

			var space = document.createElement("span");
			space.innerHTML = "\u200B";

			var range = this.getRange();
			range.insertNode(space);
			range.insertNode(node[0]);
			range.collapse(false);

			var sel = this.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);

			this.sync();
		},
		insertText: function(html)
		{
			var $html = $($.parseHTML(html));

			if ($html.length) html = $html.text();

			this.focusWithSaveScroll();

			if (this.browser('msie'))
			{
				if (!this.isIe11())
				{
					this.document.selection.createRange().pasteHTML(html);
				}
				else
				{
					this.execPasteFrag(html);
				}
			}
			else
			{
				this.document.execCommand('inserthtml', false, html);
			}

			this.sync();
		},
		insertNode: function(node)
		{
			node = node[0] || node;

			if (node.tagName == 'SPAN')
			{
				var replacementTag = 'inline';

			    var outer = node.outerHTML;

			    // Replace opening tag
			    var regex = new RegExp('<' + node.tagName, 'i');
			    var newTag = outer.replace(regex, '<' + replacementTag);

			    // Replace closing tag
			    regex = new RegExp('</' + node.tagName, 'i');
			    newTag = newTag.replace(regex, '</' + replacementTag);
			    node = $(newTag)[0];
			}

			var sel = this.getSelection();
			if (sel.getRangeAt && sel.rangeCount)
			{
				// with delete contents
				range = sel.getRangeAt(0);
				range.deleteContents();
				range.insertNode(node);
				range.setEndAfter(node);
				range.setStartAfter(node);
				sel.removeAllRanges();
				sel.addRange(range);
			}

			return node;
		},
		insertNodeToCaretPositionFromPoint: function(e, node)
		{
			var range;
			var x = e.clientX, y = e.clientY;
			if (this.document.caretPositionFromPoint)
			{
			    var pos = this.document.caretPositionFromPoint(x, y);
			    range = this.getRange();
			    range.setStart(pos.offsetNode, pos.offset);
			    range.collapse(true);
			    range.insertNode(node);
			}
			else if (this.document.caretRangeFromPoint)
			{
			    range = this.document.caretRangeFromPoint(x, y);
			    range.insertNode(node);
			}
			else if (typeof document.body.createTextRange != "undefined")
			{
		        range = this.document.body.createTextRange();
		        range.moveToPoint(x, y);
		        var endRange = range.duplicate();
		        endRange.moveToPoint(x, y);
		        range.setEndPoint("EndToEnd", endRange);
		        range.select();
			}

		},
		insertAfterLastElement: function(element, parent)
		{
			if (typeof(parent) != 'undefined') element = parent;

			if (this.isEndOfElement())
			{
				if (this.opts.linebreaks)
				{
					var contents = $('<div>').append($.trim(this.$editor.html())).contents();
					var last = contents.last()[0];
					if (last.tagName == 'SPAN' && last.innerHTML == '')
					{
						last = contents.prev()[0];
					}

					if (this.outerHtml(last) != this.outerHtml(element))
					{
						return false;
					}
				}
				else
				{
					if (this.$editor.contents().last()[0] !== element)
					{
						return false;
					}
				}

				this.insertingAfterLastElement(element);
			}
		},
		insertingAfterLastElement: function(element)
		{
			this.bufferSet();

			if (this.opts.linebreaks === false)
			{
				var node = $(this.opts.emptyHtml);
				$(element).after(node);
				this.selectionStart(node);
			}
			else
			{
				var node = $('<span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>', this.document)[0];
				$(element).after(node);
				$(node).after(this.opts.invisibleSpace);
				this.selectionRestore();
				this.$editor.find('span#selection-marker-1').removeAttr('id');
			}
		},
		insertLineBreak: function(twice)
		{
			this.selectionSave();

			var br = '<br>';
			if (twice == true)
			{
				br = '<br><br>';
			}

			if (this.browser('mozilla'))
			{
				var span = $('<span>').html(this.opts.invisibleSpace);
				this.$editor.find('#selection-marker-1').before(br).before(span).before(this.opts.invisibleSpace);

				this.setCaretAfter(span[0]);
				span.remove();

				this.selectionRemoveMarkers();
			}
			else
			{
				var parent = this.getParent();
				if (parent && parent.tagName === 'A')
				{
					var offset = this.getCaretOffset(parent);

					var text = $.trim($(parent).text()).replace(/\n\r\n/g, '');
					var len = text.length;

					if (offset == len)
					{
						this.selectionRemoveMarkers();

						var node = $('<span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>', this.document)[0];
						$(parent).after(node);
						$(node).before(br + (this.browser('webkit') ? this.opts.invisibleSpace : ''));
						this.selectionRestore();

						return true;
					}

				}

				this.$editor.find('#selection-marker-1').before(br + (this.browser('webkit') ? this.opts.invisibleSpace : ''));
				this.selectionRestore();
			}
		},
		insertDoubleLineBreak: function()
		{
			this.insertLineBreak(true);
		},
		replaceLineBreak: function(element)
		{
			var node = $('<br>' + this.opts.invisibleSpace);
			$(element).replaceWith(node);
			this.selectionStart(node);
		},

		// PASTE
		pasteClean: function(html)
		{
			html = this.callback('pasteBefore', false, html);

			// ie10 fix paste links
			if (this.browser('msie'))
			{
				var tmp = $.trim(html);
				if (tmp.search(/^<a(.*?)>(.*?)<\/a>$/i) == 0)
				{
					html = html.replace(/^<a(.*?)>(.*?)<\/a>$/i, "$2");
				}
			}

			if (this.opts.pastePlainText)
			{
				var tmp = this.document.createElement('div');

				html = html.replace(/<br>|<\/H[1-6]>|<\/p>|<\/div>/gi, '\n');

				tmp.innerHTML = html;
				html = tmp.textContent || tmp.innerText;

				html = $.trim(html);
				html = html.replace('\n', '<br>');
				html = this.cleanParagraphy(html);

				this.pasteInsert(html);
				return false;
			}

			// clean up table
			var tablePaste = false;
			if (this.currentOrParentIs('TD'))
			{
				tablePaste = true;
				var blocksElems = this.opts.blockLevelElements;
				blocksElems.push('tr');
				blocksElems.push('table');
				$.each(blocksElems, function(i,s)
				{
					html = html.replace(new RegExp('<' + s + '(.*?)>', 'gi'), '');
					html = html.replace(new RegExp('</' + s + '>', 'gi'), '<br>');
				});
			}

			// clean up pre
			if (this.currentOrParentIs('PRE'))
			{
				html = this.pastePre(html);
				this.pasteInsert(html);
				return true;
			}

			// ms words shapes
			html = html.replace(/<img(.*?)v:shapes=(.*?)>/gi, '');

			// ms word list
			html = html.replace(/<p(.*?)class="MsoListParagraphCxSpFirst"([\w\W]*?)<\/p>/gi, '<ul><li$2</li>');
			html = html.replace(/<p(.*?)class="MsoListParagraphCxSpMiddle"([\w\W]*?)<\/p>/gi, '<li$2</li>');
			html = html.replace(/<p(.*?)class="MsoListParagraphCxSpLast"([\w\W]*?)<\/p>/gi, '<li$2</li></ul>');
			// one line
			html = html.replace(/<p(.*?)class="MsoListParagraph"([\w\W]*?)<\/p>/gi, '<ul><li$2</li></ul>');
			// remove ms word's bullet
			html = html.replace(/·/g, '');

			// remove comments and php tags
			html = html.replace(/<!--[\s\S]*?-->|<\?(?:php)?[\s\S]*?\?>/gi, '');

			// remove nbsp
			if (this.opts.cleanSpaces === true)
			{
				html = html.replace(/(&nbsp;){2,}/gi, '&nbsp;');
				html = html.replace(/&nbsp;/gi, ' ');
			}

			// remove google docs marker
			html = html.replace(/<b\sid="internal-source-marker(.*?)">([\w\W]*?)<\/b>/gi, "$2");
			html = html.replace(/<b(.*?)id="docs-internal-guid(.*?)">([\w\W]*?)<\/b>/gi, "$3");


	 		html = html.replace(/<span[^>]*(font-style: italic; font-weight: bold|font-weight: bold; font-style: italic)[^>]*>/gi, '<span style="font-weight: bold;"><span style="font-style: italic;">');
	 		html = html.replace(/<span[^>]*font-style: italic[^>]*>/gi, '<span style="font-style: italic;">');
			html = html.replace(/<span[^>]*font-weight: bold[^>]*>/gi, '<span style="font-weight: bold;">');
			html = html.replace(/<span[^>]*text-decoration: underline[^>]*>/gi, '<span style="text-decoration: underline;">');

			// strip tags
			//html = this.cleanStripTags(html);



			// prevert
			html = html.replace(/<td>\u200b*<\/td>/gi, '[td]');
			html = html.replace(/<td>&nbsp;<\/td>/gi, '[td]');
			html = html.replace(/<td><br><\/td>/gi, '[td]');
			html = html.replace(/<td(.*?)colspan="(.*?)"(.*?)>([\w\W]*?)<\/td>/gi, '[td colspan="$2"]$4[/td]');
			html = html.replace(/<td(.*?)rowspan="(.*?)"(.*?)>([\w\W]*?)<\/td>/gi, '[td rowspan="$2"]$4[/td]');
			html = html.replace(/<a(.*?)href="(.*?)"(.*?)>([\w\W]*?)<\/a>/gi, '[a href="$2"]$4[/a]');
			html = html.replace(/<iframe(.*?)>([\w\W]*?)<\/iframe>/gi, '[iframe$1]$2[/iframe]');
			html = html.replace(/<video(.*?)>([\w\W]*?)<\/video>/gi, '[video$1]$2[/video]');
			html = html.replace(/<audio(.*?)>([\w\W]*?)<\/audio>/gi, '[audio$1]$2[/audio]');
			html = html.replace(/<embed(.*?)>([\w\W]*?)<\/embed>/gi, '[embed$1]$2[/embed]');
			html = html.replace(/<object(.*?)>([\w\W]*?)<\/object>/gi, '[object$1]$2[/object]');
			html = html.replace(/<param(.*?)>/gi, '[param$1]');

			html = html.replace(/<img(.*?)>/gi, '[img$1]');

			// remove classes
			html = html.replace(/ class="(.*?)"/gi, '');

			// remove all attributes
			html = html.replace(/<(\w+)([\w\W]*?)>/gi, '<$1>');

			// remove empty
			if (this.opts.linebreaks)
			{
				// prevent double linebreaks when an empty line in RTF has bold or underlined formatting associated with it
				html = html.replace(/<strong><\/strong>/gi, '');
				html = html.replace(/<u><\/u>/gi, '');

				if (this.opts.cleanFontTag)
				{
					html = html.replace(/<font(.*?)>([\w\W]*?)<\/font>/gi, '$2');
				}

				html = html.replace(/<[^\/>][^>]*>(\s*|\t*|\n*|&nbsp;|<br>)<\/[^>]+>/gi, '<br>');
			}
			else
			{
				html = html.replace(/<[^\/>][^>]*>(\s*|\t*|\n*|&nbsp;|<br>)<\/[^>]+>/gi, '');
			}

			html = html.replace(/<div>\s*?\t*?\n*?(<ul>|<ol>|<p>)/gi, '$1');

			// revert
			html = html.replace(/\[td colspan="(.*?)"\]([\w\W]*?)\[\/td\]/gi, '<td colspan="$1">$2</td>');
			html = html.replace(/\[td rowspan="(.*?)"\]([\w\W]*?)\[\/td\]/gi, '<td rowspan="$1">$2</td>');
			html = html.replace(/\[td\]/gi, '<td>&nbsp;</td>');
			html = html.replace(/\[a href="(.*?)"\]([\w\W]*?)\[\/a\]/gi, '<a href="$1">$2</a>');
			html = html.replace(/\[iframe(.*?)\]([\w\W]*?)\[\/iframe\]/gi, '<iframe$1>$2</iframe>');
			html = html.replace(/\[video(.*?)\]([\w\W]*?)\[\/video\]/gi, '<video$1>$2</video>');
			html = html.replace(/\[audio(.*?)\]([\w\W]*?)\[\/audio\]/gi, '<audio$1>$2</audio>');
			html = html.replace(/\[embed(.*?)\]([\w\W]*?)\[\/embed\]/gi, '<embed$1>$2</embed>');
			html = html.replace(/\[object(.*?)\]([\w\W]*?)\[\/object\]/gi, '<object$1>$2</object>');
			html = html.replace(/\[param(.*?)\]/gi, '<param$1>');
			html = html.replace(/\[img(.*?)\]/gi, '<img$1>');

			// convert div to p
			if (this.opts.convertDivs)
			{
				html = html.replace(/<div(.*?)>([\w\W]*?)<\/div>/gi, '<p>$2</p>');
				html = html.replace(/<\/div><p>/gi, '<p>');
				html = html.replace(/<\/p><\/div>/gi, '</p>');
				html = html.replace(/<p><\/p>/gi, '<br />');
			}
			else
			{
				html = html.replace(/<div><\/div>/gi, '<br />');
			}

			// strip tags
			html = this.cleanStripTags(html);

			if (this.currentOrParentIs('LI'))
			{
				html = html.replace(/<p>([\w\W]*?)<\/p>/gi, '$1<br>');
			}
			else if (tablePaste === false)
			{
				html = this.cleanParagraphy(html);
			}

			// remove span
			html = html.replace(/<span(.*?)>([\w\W]*?)<\/span>/gi, '$2');

			// remove empty
			html = html.replace(/<img>/gi, '');
			html = html.replace(/<[^\/>][^>][^img|param|source|td][^<]*>(\s*|\t*|\n*| |<br>)<\/[^>]+>/gi, '');

			html = html.replace(/\n{3,}/gi, '\n');

			// remove dirty p
			html = html.replace(/<p><p>/gi, '<p>');
			html = html.replace(/<\/p><\/p>/gi, '</p>');

			html = html.replace(/<li>(\s*|\t*|\n*)<p>/gi, '<li>');
			html = html.replace(/<\/p>(\s*|\t*|\n*)<\/li>/gi, '</li>');

			if (this.opts.linebreaks === true)
			{
				html = html.replace(/<p(.*?)>([\w\W]*?)<\/p>/gi, '$2<br>');
			}

			// remove empty finally
			html = html.replace(/<[^\/>][^>][^img|param|source|td][^<]*>(\s*|\t*|\n*| |<br>)<\/[^>]+>/gi, '');

			// remove safari local images
			html = html.replace(/<img src="webkit-fake-url\:\/\/(.*?)"(.*?)>/gi, '');

			// remove p in td
			html = html.replace(/<td(.*?)>(\s*|\t*|\n*)<p>([\w\W]*?)<\/p>(\s*|\t*|\n*)<\/td>/gi, '<td$1>$3</td>');

			// remove divs
			if (this.opts.convertDivs)
			{
				html = html.replace(/<div(.*?)>([\w\W]*?)<\/div>/gi, '$2');
				html = html.replace(/<div(.*?)>([\w\W]*?)<\/div>/gi, '$2');
			}

			// FF specific
			this.pasteClipboardMozilla = false;
			if (this.browser('mozilla'))
			{
				if (this.opts.clipboardUpload)
				{
					var matches = html.match(/<img src="data:image(.*?)"(.*?)>/gi);
					if (matches !== null)
					{
						this.pasteClipboardMozilla = matches;
						for (k in matches)
						{
							var img = matches[k].replace('<img', '<img data-mozilla-paste-image="' + k + '" ');
							html = html.replace(matches[k], img);
						}
					}
				}

				// FF fix
				while (/<br>$/gi.test(html))
				{
					html = html.replace(/<br>$/gi, '');
				}
			}

			// bullets again
			html = html.replace(/<p>•([\w\W]*?)<\/p>/gi, '<li>$1</li>');

			// ie inserts a blank font tags when pasting
			if (this.browser('msie'))
			{
				while (/<font>([\w\W]*?)<\/font>/gi.test(html))
				{
					html = html.replace(/<font>([\w\W]*?)<\/font>/gi, '$1');
				}
			}

			// remove table paragraphs
			if (tablePaste === false)
			{
				html = html.replace(/<td(.*?)>([\w\W]*?)<p(.*?)>([\w\W]*?)<\/td>/gi, '<td$1>$2$4</td>');
				html = html.replace(/<td(.*?)>([\w\W]*?)<\/p>([\w\W]*?)<\/td>/gi, '<td$1>$2$3</td>');
				html = html.replace(/<td(.*?)>([\w\W]*?)<p(.*?)>([\w\W]*?)<\/td>/gi, '<td$1>$2$4</td>');
				html = html.replace(/<td(.*?)>([\w\W]*?)<\/p>([\w\W]*?)<\/td>/gi, '<td$1>$2$3</td>');
			}

			// ms word break lines
			html = html.replace(/\n/g, ' ');

			// ms word lists break lines
			html = html.replace(/<p>\n?<li>/gi, '<li>');

			this.pasteInsert(html);

		},
		pastePre: function(s)
		{
			s = s.replace(/<br>|<\/H[1-6]>|<\/p>|<\/div>/gi, '\n');

			var tmp = this.document.createElement('div');
			tmp.innerHTML = s;
			return this.cleanEncodeEntities(tmp.textContent || tmp.innerText);
		},
		pasteInsert: function(html)
		{
			html = this.callback('pasteAfter', false, html);

			if (this.selectall)
			{
				this.$editor.html(html);
				this.selectionRemove();
				this.focusEnd();
				this.sync();
			}
			else
			{
				this.insertHtml(html);
			}

			this.selectall = false;

			setTimeout($.proxy(function()
			{
				this.rtePaste = false;

				// FF specific
				if (this.browser('mozilla'))
				{
					this.$editor.find('p:empty').remove()
				}
				if (this.pasteClipboardMozilla !== false)
				{
					this.pasteClipboardUploadMozilla();
				}

			}, this), 100);

			if (this.opts.autoresize && this.fullscreen !== true)
			{
				$(this.document.body).scrollTop(this.saveScroll);
			}
			else
			{
				this.$editor.scrollTop(this.saveScroll);
			}
		},
		pasteClipboardAppendFields: function(postData)
		{
			// append hidden fields
			if (this.opts.uploadFields !== false && typeof this.opts.uploadFields === 'object')
			{
				$.each(this.opts.uploadFields, $.proxy(function(k, v)
				{
					if (v != null && v.toString().indexOf('#') === 0) v = $(v).val();
					postData[k] = v;

				}, this));
			}

			return postData;
		},
		pasteClipboardUploadMozilla: function()
		{
			var imgs = this.$editor.find('img[data-mozilla-paste-image]');
			$.each(imgs, $.proxy(function(i,s)
			{
				var $s = $(s);
				var arr = s.src.split(",");
				var postData = {
					'contentType': arr[0].split(";")[0].split(":")[1],
					'data': arr[1] // raw base64
				};

				// append hidden fields
				postData = this.pasteClipboardAppendFields(postData);

				$.post(this.opts.clipboardUploadUrl, postData,
				$.proxy(function(data)
				{
					var json = (typeof data === 'string' ? $.parseJSON(data) : data);
		        	$s.attr('src', json.filelink);
		        	$s.removeAttr('data-mozilla-paste-image');

		        	this.sync();

					// upload callback
					this.callback('imageUpload', $s, json);

				}, this));

			}, this));
		},
		pasteClipboardUpload: function(e)
		{
	        var result = e.target.result;
			var arr = result.split(",");
			var postData = {
				'contentType': arr[0].split(";")[0].split(":")[1],
				'data': arr[1] // raw base64
			};


			if (this.opts.clipboardUpload)
			{
				// append hidden fields
				postData = this.pasteClipboardAppendFields(postData);

				$.post(this.opts.clipboardUploadUrl, postData,
				$.proxy(function(data)
				{
					var json = (typeof data === 'string' ? $.parseJSON(data) : data);

					var html = '<img src="' + json.filelink + '" id="clipboard-image-marker" />';
					this.execCommand('inserthtml', html, false);

					var image = $(this.$editor.find('img#clipboard-image-marker'));

					if (image.length) image.removeAttr('id');
					else image = false;

					this.sync();

					// upload callback
					if (image)
					{
						this.callback('imageUpload', image, json);
					}


				}, this));
			}
			else
			{
	        	this.insertHtml('<img src="' + result + '" />');
        	}
		},

		// BUFFER
		bufferSet: function(selectionSave)
		{
			if (selectionSave !== false)
			{
				this.selectionSave();
			}

			this.opts.buffer.push(this.$editor.html());

			if (selectionSave !== false)
			{
				this.selectionRemoveMarkers('buffer');
			}

		},
		bufferUndo: function()
		{
			if (this.opts.buffer.length === 0)
			{
				this.focusWithSaveScroll();
				return;
			}

			// rebuffer
			this.selectionSave();
			this.opts.rebuffer.push(this.$editor.html());
			this.selectionRestore(false, true);

			this.$editor.html(this.opts.buffer.pop());

			this.selectionRestore();
			setTimeout($.proxy(this.observeStart, this), 100);
		},
		bufferRedo: function()
		{
			if (this.opts.rebuffer.length === 0)
			{
				this.focusWithSaveScroll();
				return false;
			}

			// buffer
			this.selectionSave();
			this.opts.buffer.push(this.$editor.html());
			this.selectionRestore(false, true);

			this.$editor.html(this.opts.rebuffer.pop());
			this.selectionRestore(true);
			setTimeout($.proxy(this.observeStart, this), 4);
		},

		// OBSERVE
		observeStart: function()
		{
			this.observeImages();

			if (this.opts.observeLinks) this.observeLinks();
		},
		observeLinks: function()
		{
			this.$editor.find('a').on('click', $.proxy(this.linkObserver, this));

			this.$editor.on('click.redactor', $.proxy(function(e)
			{
				this.linkObserverTooltipClose(e);

			}, this));

			$(document).on('click.redactor', $.proxy(function(e)
			{
				this.linkObserverTooltipClose(e);

			}, this));
		},
		observeImages: function()
		{
			if (this.opts.observeImages === false) return false;

			this.$editor.find('img').each($.proxy(function(i, elem)
			{
				if (this.browser('msie')) $(elem).attr('unselectable', 'on');

				var parent = $(elem).parent();
				if (!parent.hasClass('royalSlider') && !parent.hasClass('fotorama'))
				{
					this.imageResize(elem);
				}

			}, this));

			// royalSlider and fotorama
			this.$editor.find('.fotorama, .royalSlider').on('click', $.proxy(this.editGallery, this));

		},
		linkObserver: function(e)
		{
			var $link = $(e.target);

			var parent = $(e.target).parent();
			if (parent.hasClass('royalSlider') || parent.hasClass('fotorama'))
			{
				return;
			}

			if ($link.size() == 0 || $link[0].tagName !== 'A') return;

			var pos = $link.offset();
			if (this.opts.iframe)
			{
				var posFrame = this.$frame.offset();
				pos.top = posFrame.top + (pos.top - $(this.document).scrollTop());
				pos.left += posFrame.left;
			}

			var tooltip = $('<span class="redactor-link-tooltip"></span>');

			var href = $link.attr('href');
			if (href === undefined)
			{
				href = '';
			}

			if (href.length > 24) href = href.substring(0, 24) + '...';

			var aLink = $('<a href="' + $link.attr('href') + '" target="_blank">' + href + '</a>').on('click', $.proxy(function(e)
			{
				this.linkObserverTooltipClose(false);
			}, this));

			var aEdit = $('<a href="#">' + this.opts.curLang.edit + '</a>').on('click', $.proxy(function(e)
			{
				e.preventDefault();
				this.linkShow();
				this.linkObserverTooltipClose(false);

			}, this));

			var aUnlink = $('<a href="#">' + this.opts.curLang.unlink + '</a>').on('click', $.proxy(function(e)
			{
				e.preventDefault();
				this.execCommand('unlink');
				this.linkObserverTooltipClose(false);

			}, this));


			tooltip.append(aLink);
			tooltip.append(' | ');
			tooltip.append(aEdit);
			tooltip.append(' | ');
			tooltip.append(aUnlink);
			tooltip.css({
				top: (pos.top + 20) + 'px',
				left: pos.left + 'px'
			});

			$('.redactor-link-tooltip').remove();
			$('body').append(tooltip);
		},
		linkObserverTooltipClose: function(e)
		{
			if (e !== false && e.target.tagName == 'A') return false;
			$('.redactor-link-tooltip').remove();
		},

		// SELECTION
		getSelection: function()
		{
			if (!this.opts.rangy) return this.document.getSelection();
			else // rangy
			{
				if (!this.opts.iframe) return rangy.getSelection();
				else return rangy.getSelection(this.$frame[0]);
			}
		},
		getRange: function()
		{
			if (!this.opts.rangy)
			{
				if (this.document.getSelection)
				{
					var sel = this.getSelection();
					if (sel.getRangeAt && sel.rangeCount) return sel.getRangeAt(0);
				}

				return this.document.createRange();
			}
			else // rangy
			{
				if (!this.opts.iframe) return rangy.createRange();
				else return rangy.createRange(this.iframeDoc());
			}
		},
		selectionElement: function(node)
		{
			this.setCaret(node);
		},
		selectionStart: function(node)
		{
			this.selectionSet(node[0] || node, 0, null, 0);
		},
		selectionEnd: function(node)
		{
			this.selectionSet(node[0] || node, 1, null, 1);
		},
		selectionSet: function(orgn, orgo, focn, foco)
		{
			if (focn == null) focn = orgn;
			if (foco == null) foco = orgo;

			var sel = this.getSelection();
			if (!sel) return;

			if (orgn.tagName == 'P' && orgn.innerHTML == '')
			{
				orgn.innerHTML = this.opts.invisibleSpace;
			}

			if (orgn.tagName == 'BR' && this.opts.linebreaks === false)
			{
				var par = $(this.opts.emptyHtml)[0];
				$(orgn).replaceWith(par);
				orgn = par;
				focn = orgn;
			}

			var range = this.getRange();
			range.setStart(orgn, orgo);
			range.setEnd(focn, foco );

			try {
				sel.removeAllRanges();
			} catch (e) {}

			sel.addRange(range);
		},
		selectionWrap: function(tag)
		{
			tag = tag.toLowerCase();

			var block = this.getBlock();
			if (block)
			{
				var wrapper = this.formatChangeTag(block, tag);
				this.sync();
				return wrapper;
			}

			var sel = this.getSelection();
			var range = sel.getRangeAt(0);
			var wrapper = document.createElement(tag);
			wrapper.appendChild(range.extractContents());
			range.insertNode(wrapper);

			this.selectionElement(wrapper);

			return wrapper;
		},
		selectionAll: function()
		{
			var range = this.getRange();
			range.selectNodeContents(this.$editor[0]);

			var sel = this.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
		},
		selectionRemove: function()
		{
			this.getSelection().removeAllRanges();
		},
		getCaretOffset: function (element)
		{
			var caretOffset = 0;

			var range = this.getRange();
			var preCaretRange = range.cloneRange();
			preCaretRange.selectNodeContents(element);
			preCaretRange.setEnd(range.endContainer, range.endOffset);
			caretOffset = $.trim(preCaretRange.toString()).length;

			return caretOffset;
		},
		getCaretOffsetRange: function()
		{
			return new Range(this.getSelection().getRangeAt(0));
		},
		setCaret: function (el, start, end)
		{
			if (typeof end === 'undefined') end = start;
			el = el[0] || el;

			var range = this.getRange();
			range.selectNodeContents(el);

			var textNodes = this.getTextNodesIn(el);
			var foundStart = false;
			var charCount = 0, endCharCount;

			if (textNodes.length == 1 && start)
			{
				range.setStart(textNodes[0], start);
				range.setEnd(textNodes[0], end);
			}
			else
			{
				for (var i = 0, textNode; textNode = textNodes[i++];)
				{
					endCharCount = charCount + textNode.length;
					if (!foundStart && start >= charCount && (start < endCharCount || (start == endCharCount && i < textNodes.length)))
					{
						range.setStart(textNode, start - charCount);
						foundStart = true;
					}

					if (foundStart && end <= endCharCount)
					{
						range.setEnd( textNode, end - charCount );
						break;
					}

					charCount = endCharCount;
				}
			}

			var sel = this.getSelection();
			sel.removeAllRanges();
			sel.addRange( range );
		},
		setCaretAfter: function(node)
		{
			this.$editor.focus();

			node = node[0] || node;

			var range = this.document.createRange()

			var start = 1;
			var end = -1;

			range.setStart(node, start)
			range.setEnd(node, end + 2)


			var selection = this.window.getSelection()
			var cursorRange = this.document.createRange()

			var emptyElement = this.document.createTextNode('\u200B')
			$(node).after(emptyElement)

			cursorRange.setStartAfter(emptyElement)

			selection.removeAllRanges()
			selection.addRange(cursorRange)
			$(emptyElement).remove();
		},
		getTextNodesIn: function (node)
		{
			var textNodes = [];

			if (node.nodeType == 3) textNodes.push(node);
			else
			{
				var children = node.childNodes;
				for (var i = 0, len = children.length; i < len; ++i)
				{
					textNodes.push.apply(textNodes, this.getTextNodesIn(children[i]));
				}
			}

			return textNodes;
		},

		// GET ELEMENTS
		getCurrent: function()
		{
			var el = false;
			var sel = this.getSelection();

			if (sel && sel.rangeCount > 0)
			{
				el = sel.getRangeAt(0).startContainer;
				//el = sel.getRangeAt(0).commonAncestorContainer;
			}

			return this.isParentRedactor(el);
		},
		getParent: function(elem)
		{
			elem = elem || this.getCurrent();
			if (elem) return this.isParentRedactor( $( elem ).parent()[0] );
			else return false;
		},
		getBlock: function(node)
		{
			if (typeof node === 'undefined') node = this.getCurrent();

			while (node)
			{
				if (this.nodeTestBlocks(node))
				{
					if ($(node).hasClass('redactor_editor')) return false;
					return node;
				}

				node = node.parentNode;
			}

			return false;
		},
		getBlocks: function(nodes)
		{
			var newnodes = [];
			if (typeof nodes == 'undefined')
			{
				var range = this.getRange();
				if (range && range.collapsed === true) return [this.getBlock()];
				var nodes = this.getNodes(range);
			}

			$.each(nodes, $.proxy(function(i,node)
			{
				if (this.opts.iframe === false && $(node).parents('div.redactor_editor').size() == 0) return false;
				if (this.nodeTestBlocks(node)) newnodes.push(node);

			}, this));

			if (newnodes.length === 0) newnodes = [this.getBlock()];

			return newnodes;
		},
		isInlineNode: function(node)
		{
			if (node.nodeType != 1) return false;

			return !this.rTestBlock.test(node.nodeName);
		},
		nodeTestBlocks: function(node)
		{
			return node.nodeType == 1 && this.rTestBlock.test(node.nodeName);
		},
		tagTestBlock: function(tag)
		{
			return this.rTestBlock.test(tag);
		},
		getNodes: function(range, tag)
		{
			if (typeof range == 'undefined' || range == false) var range = this.getRange();
			if (range && range.collapsed === true)
			{
				if (typeof tag === 'undefined' && this.tagTestBlock(tag))
				{
					var block = this.getBlock();
					if (block.tagName == tag) return [block];
					else return [];
				}
				else
				{
					return [this.getCurrent()];
				}
			}

			var nodes = [], finalnodes = [];

			var sel = this.document.getSelection();
			if (!sel.isCollapsed) nodes = this.getRangeSelectedNodes(sel.getRangeAt(0));

			$.each(nodes, $.proxy(function(i,node)
			{
				if (this.opts.iframe === false && $(node).parents('div.redactor_editor').size() == 0) return false;

				if (typeof tag === 'undefined')
				{
					if ($.trim(node.textContent) != '')
					{
						finalnodes.push(node);
					}
				}
				else if (node.tagName == tag)
				{
					finalnodes.push(node);
				}

			}, this));

			if (finalnodes.length == 0)
			{
				if (typeof tag === 'undefined' && this.tagTestBlock(tag))
				{
					var block = this.getBlock();
					if (block.tagName == tag) return finalnodes.push(block);
					else return [];
				}
				else
				{
					finalnodes.push(this.getCurrent());
				}
			}

			// last element filtering
			var last = finalnodes[finalnodes.length-1];
			if (this.nodeTestBlocks(last))
			{
				finalnodes = finalnodes.slice(0, -1);
			}

			return finalnodes;
		},
		getElement: function(node)
		{
			if (!node) node = this.getCurrent();
			while (node)
			{
				if (node.nodeType == 1)
				{
					if ($(node).hasClass('redactor_editor')) return false;
					return node;
				}

				node = node.parentNode;
			}

			return false;
		},
		getRangeSelectedNodes: function(range)
		{
			range = range || this.getRange();
			var node = range.startContainer;
			var endNode = range.endContainer;

			if (node == endNode) return [node];

			var rangeNodes = [];
			while (node && node != endNode)
			{
				rangeNodes.push(node = this.nextNode(node));
			}

			node = range.startContainer;
			while (node && node != range.commonAncestorContainer)
			{
				rangeNodes.unshift(node);
				node = node.parentNode;
			}

			return rangeNodes;
		},
		nextNode: function(node)
		{
			if (node.hasChildNodes()) return node.firstChild;
			else
			{
				while (node && !node.nextSibling)
				{
					node = node.parentNode;
				}

				if (!node) return null;
				return node.nextSibling;
			}
		},

		// GET SELECTION HTML OR TEXT
		getSelectionText: function()
		{
			return this.getSelection().toString();
		},
		getSelectionHtml: function()
		{
			var html = '';

			var sel = this.getSelection();
			if (sel.rangeCount)
			{
				var container = this.document.createElement( "div" );
				var len = sel.rangeCount;
				for (var i = 0; i < len; ++i)
				{
					container.appendChild(sel.getRangeAt(i).cloneContents());
				}

				html = container.innerHTML;
			}

			return this.syncClean(html);
		},

		// SAVE & RESTORE
		selectionSave: function()
		{
			if (!this.isFocused())
			{
				this.focusWithSaveScroll();
			}

			if (!this.opts.rangy)
			{
				this.selectionCreateMarker(this.getRange());
			}
			// rangy
			else
			{
				this.savedSel = rangy.saveSelection();
			}
		},
		selectionCreateMarker: function(range, remove)
		{
			if (!range) return;

			var node1 = $('<span id="selection-marker-1" class="redactor-selection-marker">' + this.opts.invisibleSpace + '</span>', this.document)[0];
			var node2 = $('<span id="selection-marker-2" class="redactor-selection-marker">' + this.opts.invisibleSpace + '</span>', this.document)[0];

			if (range.collapsed === true)
			{
				this.selectionSetMarker(range, node1, true);
			}
			else
			{
				this.selectionSetMarker(range, node1, true);
				this.selectionSetMarker(range, node2, false);
			}

			this.savedSel = this.$editor.html();

			this.selectionRestore(false, false);
		},
		selectionSetMarker: function(range, node, type)
		{
			var boundaryRange = range.cloneRange();

			try {
				boundaryRange.collapse(type);
				boundaryRange.insertNode(node);
				boundaryRange.detach();
			}
			catch (e)
			{
				var html = this.opts.emptyHtml;
				if (this.opts.linebreaks) html = '<br>';

				this.$editor.prepend(html);
				this.focus();
			}
		},
		selectionRestore: function(replace, remove)
		{
			if (!this.opts.rangy)
			{
				if (replace === true && this.savedSel)
				{
					this.$editor.html(this.savedSel);
				}

				var node1 = this.$editor.find('span#selection-marker-1');
				var node2 = this.$editor.find('span#selection-marker-2');

				if (this.browser('mozilla'))
				{
					this.$editor.focus();
				}
				else if (!this.isFocused())
				{
					this.focusWithSaveScroll();
				}

				if (node1.length != 0 && node2.length != 0)
				{

					this.selectionSet(node1[0], 0, node2[0], 0);
				}
				else if (node1.length != 0)
				{
					this.selectionSet(node1[0], 0, null, 0);
				}

				if (remove !== false)
				{
					this.selectionRemoveMarkers();
					this.savedSel = false;
				}
			}
			// rangy
			else
			{
				rangy.restoreSelection(this.savedSel);
			}
		},
		selectionRemoveMarkers: function(type)
		{
			if (!this.opts.rangy)
			{
				$.each(this.$editor.find('span.redactor-selection-marker'), function()
				{
					var html = $.trim($(this).html().replace(/[^\u0000-\u1C7F]/g, ''));
					if (html == '')
					{
						$(this).remove();
					}
					else
					{
						$(this).removeAttr('class').removeAttr('id');
					}
				});
			}
			// rangy
			else
			{
				rangy.removeMarkers(this.savedSel);
			}
		},

		// TABLE
		tableShow: function()
		{
			this.selectionSave();

			this.modalInit(this.opts.curLang.table, this.opts.modal_table, 300, $.proxy(function()
			{
				$('#redactor_insert_table_btn').click($.proxy(this.tableInsert, this));

				setTimeout(function()
				{
					$('#redactor_table_rows').focus();

				}, 200);

			}, this));
		},
		tableInsert: function()
		{
			this.bufferSet(false);

			var rows = $('#redactor_table_rows').val(),
				columns = $('#redactor_table_columns').val(),
				$table_box = $('<div></div>'),
				tableId = Math.floor(Math.random() * 99999),
				$table = $('<table id="table' + tableId + '"><tbody></tbody></table>'),
				i, $row, z, $column;

			for (i = 0; i < rows; i++)
			{
				$row = $('<tr></tr>');

				for (z = 0; z < columns; z++)
				{
					$column = $('<td>' + this.opts.invisibleSpace + '</td>');

					// set the focus to the first td
					if (i === 0 && z === 0)
					{
						$column.append('<span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>');
					}

					$($row).append($column);
				}

				$table.append($row);
			}

			$table_box.append($table);
			var html = $table_box.html();

			if (this.opts.linebreaks === false && this.browser('mozilla'))
			{
				html += '<p>' + this.opts.invisibleSpace + '</p>';
			}

			this.modalClose();
			this.selectionRestore();

			var current = this.getBlock() || this.getCurrent();

			if (current && current.tagName != 'BODY')
			{
				if (current.tagName == 'LI')
				{
					var current = $(current).closest('ul, ol');
				}

				$(current).after(html)
			}
			else
			{
				this.insertHtmlAdvanced(html, false);
			}

			this.selectionRestore();

			var table = this.$editor.find('#table' + tableId);
			this.buttonActiveObserver();

			table.find('span#selection-marker-1, inline#selection-marker-1').remove();
			table.removeAttr('id');

			this.sync();
		},
		tableDeleteTable: function()
		{
			var $table = $(this.getParent()).closest('table');
			if (!this.isParentRedactor($table)) return false;
			if ($table.size() == 0) return false;

			this.bufferSet();

			$table.remove();
			this.sync();
		},
		tableDeleteRow: function()
		{
			var parent = this.getParent();
			var $table = $(parent).closest('table');


			if (!this.isParentRedactor($table)) return false;
			if ($table.size() == 0) return false;

			this.bufferSet();

			var $current_tr = $(parent).closest('tr');
			var $focus_tr = $current_tr.prev().length ? $current_tr.prev() : $current_tr.next();
			if ($focus_tr.length)
			{
				var $focus_td = $focus_tr.children('td' ).first();
				if ($focus_td.length)
				{
					$focus_td.prepend('<span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>');
				}
			}

			$current_tr.remove();
			this.selectionRestore();
			$table.find('span#selection-marker-1').remove();
			this.sync();
		},
		tableDeleteColumn: function()
		{
			var parent = this.getParent();
			var $table = $(parent).closest('table');

			if (!this.isParentRedactor($table)) return false;
			if ($table.size() == 0) return false;

			this.bufferSet();

			var $current_td = $(parent).closest('td');
			if (!($current_td.is('td')))
			{
				$current_td = $current_td.closest('td');
			}

			var index = $current_td.get(0).cellIndex;

			// Set the focus correctly
			$table.find('tr').each($.proxy(function(i, elem)
			{
				var focusIndex = index - 1 < 0 ? index + 1 : index - 1;
				if (i === 0)
				{
					$(elem).find('td').eq(focusIndex).prepend('<span id="selection-marker-1">' + this.opts.invisibleSpace + '</span>');
				}

				$(elem).find('td').eq(index).remove();

			}, this));

			this.selectionRestore();
			$table.find('span#selection-marker-1').remove();
			this.sync();
		},
		tableAddHead: function()
		{
			var $table = $(this.getParent()).closest('table');
			if (!this.isParentRedactor($table)) return false;
			if ($table.size() == 0) return false;

			this.bufferSet();

			if ($table.find('thead').size() !== 0) this.tableDeleteHead();
			else
			{
				var tr = $table.find('tr').first().clone();
				tr.find('td').html(this.opts.invisibleSpace);
				$thead = $('<thead></thead>');
				$thead.append(tr);
				$table.prepend($thead);

				this.sync();
			}
		},
		tableDeleteHead: function()
		{
			var $table = $(this.getParent()).closest('table');
			if (!this.isParentRedactor($table)) return false;
			var $thead = $table.find('thead');

			if ($thead.size() == 0) return false;

			this.bufferSet();

			$thead.remove();
			this.sync();
		},
		tableAddRowAbove: function()
		{
			this.tableAddRow('before');
		},
		tableAddRowBelow: function()
		{
			this.tableAddRow('after');
		},
		tableAddColumnLeft: function()
		{
			this.tableAddColumn('before');
		},
		tableAddColumnRight: function()
		{
			this.tableAddColumn('after');
		},
		tableAddRow: function(type)
		{
			var $table = $(this.getParent()).closest('table');
			if (!this.isParentRedactor($table)) return false;
			if ($table.size() == 0) return false;

			this.bufferSet();

			var $current_tr = $(this.getParent()).closest('tr');
			var new_tr = $current_tr.clone();
			new_tr.find('td').html(this.opts.invisibleSpace);

			if (type === 'after') $current_tr.after(new_tr);
			else $current_tr.before(new_tr);

			this.sync();
		},
		tableAddColumn: function (type)
		{
			var parent = this.getParent();
			var $table = $(parent).closest('table');

			if (!this.isParentRedactor($table)) return false;
			if ($table.size() == 0) return false;

			this.bufferSet();

			var index = 0;

			var current = this.getCurrent();
			var $current_tr = $(current).closest('tr');
			var $current_td =  $(current).closest('td');

			$current_tr.find('td').each($.proxy(function(i, elem)
			{
				if ($(elem)[0] === $current_td[0]) index = i;

			}, this));

			$table.find('tr').each($.proxy(function(i, elem)
			{
				var $current = $(elem).find('td').eq(index);

				var td = $current.clone();
				td.html(this.opts.invisibleSpace);

				type === 'after' ? $current.after(td) : $current.before(td);

			}, this));

			this.sync();
		},

		// VIDEO
		videoShow: function()
		{
			this.selectionSave();

			this.modalInit(this.opts.curLang.video, this.opts.modal_video, 600, $.proxy(function()
			{
				$('#redactor_insert_video_btn').click($.proxy(this.videoInsert, this));

				setTimeout(function()
				{
					$('#redactor_insert_video_area').focus();

				}, 200);

			}, this));
		},
		videoInsert: function ()
		{
			var data = $('#redactor_insert_video_area').val();
			data = this.cleanStripTags(data);

			// parse if it is link on youtube & vimeo
			var iframeStart = '<iframe width="500" height="281" src="',
				iframeEnd = '" frameborder="0" allowfullscreen></iframe>';

			if (data.match(reUrlYoutube))
			{
				data = data.replace(reUrlYoutube, iframeStart + '//www.youtube.com/embed/$1' + iframeEnd);
			}
			else if (data.match(reUrlVimeo))
			{
				data = data.replace(reUrlVimeo, iframeStart + '//player.vimeo.com/video/$2' + iframeEnd);
			}

			this.selectionRestore();

			var current = this.getBlock() || this.getCurrent();

			if (current) $(current).after(data)
			else this.insertHtmlAdvanced(data, false);

			this.sync();
			this.modalClose();
		},


		// LINK
		linkShow: function()
		{
			this.selectionSave();

			var callback = $.proxy(function()
			{
				// Predefined links
				if (this.opts.predefinedLinks !== false)
				{
					this.predefinedLinksStorage = {};
					var that = this;
					$.getJSON(this.opts.predefinedLinks, function(data)
					{
						var $select = $('#redactor-predefined-links');
						$select .html('');
						$.each(data, function(key, val)
						{
							that.predefinedLinksStorage[key] = val;
							$select.append($('<option>').val(key).html(val.name));
						});

						$select.on('change', function()
						{
							var key = $(this).val();
							var name = '', url = '';
							if (key != 0)
							{
								name = that.predefinedLinksStorage[key].name;
								url = that.predefinedLinksStorage[key].url;
							}

							$('#redactor_link_url').val(url);
							$('#redactor_link_url_text').val(name);

						});

						$select.show();
					});
				}

				this.insert_link_node = false;

				var sel = this.getSelection();
				var url = '', text = '', target = '';

				var elem = this.getParent();
				var par = $(elem).parent().get(0);
				if (par && par.tagName === 'A')
				{
					elem = par;
				}

				if (elem && elem.tagName === 'A')
				{
					url = elem.href;
					text = $(elem).text();
					target = elem.target;

					this.insert_link_node = elem;
				}
				else text = sel.toString();

				$('#redactor_link_url_text').val(text);

				var thref = self.location.href.replace(/\/$/i, '');
				url = url.replace(thref, '');
				url = url.replace(/^\/#/, '#');
				url = url.replace('mailto:', '');

				// remove host from href
				if (this.opts.linkProtocol === false)
				{
					var re = new RegExp('^(http|ftp|https)://' + self.location.host, 'i');
					url = url.replace(re, '');
				}

				// set url
				$('#redactor_link_url').val(url);

				if (target === '_blank')
				{
					$('#redactor_link_blank').prop('checked', true);
				}

				this.linkInsertPressed = false;
				$('#redactor_insert_link_btn').on('click', $.proxy(this.linkProcess, this));


				setTimeout(function()
				{
					$('#redactor_link_url').focus();

				}, 200);

			}, this);

			this.modalInit(this.opts.curLang.link, this.opts.modal_link, 460, callback);

		},
		linkProcess: function()
		{
			if (this.linkInsertPressed)
			{
				return;
			}

			this.linkInsertPressed = true;
			var target = '', targetBlank = '';

			var link = $('#redactor_link_url').val();
			var text = $('#redactor_link_url_text').val();

			// mailto
			if (link.search('@') != -1 && /(http|ftp|https):\/\//i.test(link) === false)
			{
				link = 'mailto:' + link;
			}
			// url, not anchor
			else if (link.search('#') != 0)
			{
				if ($('#redactor_link_blank').prop('checked'))
				{
					target = ' target="_blank"';
					targetBlank = '_blank';
				}

				// test url (add protocol)
				var pattern = '((xn--)?[a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}';
				var re = new RegExp('^(http|ftp|https)://' + pattern, 'i');
				var re2 = new RegExp('^' + pattern, 'i');

				if (link.search(re) == -1 && link.search(re2) == 0 && this.opts.linkProtocol)
				{
					link = this.opts.linkProtocol + link;
				}
			}

			text = text.replace(/<|>/g, '');
			var extra = '&nbsp;';
			if (this.browser('mozilla'))
			{
				extra = '&nbsp;';
			}

			this.linkInsert('<a href="' + link + '"' + target + '>' + text + '</a>' + extra, $.trim(text), link, targetBlank);

		},
		linkInsert: function (a, text, link, target)
		{
			this.selectionRestore();

			if (text !== '')
			{
				if (this.insert_link_node)
				{
					this.bufferSet();

					$(this.insert_link_node).text(text).attr('href', link);

					if (target !== '')
					{
						$(this.insert_link_node).attr('target', target);
					}
					else
					{
						$(this.insert_link_node).removeAttr('target');
					}
				}
				else
				{
					var $a = $(a).addClass('redactor-added-link');
					this.exec('inserthtml', this.outerHtml($a), false);

					var link = this.$editor.find('a.redactor-added-link');

					link.removeAttr('style').removeClass('redactor-added-link').each(function()
					{
						if (this.className == '') $(this).removeAttr('class');
					});

				}

				this.sync();
			}

			// link tooltip
			setTimeout($.proxy(function()
			{
				if (this.opts.observeLinks) this.observeLinks();

			}, this), 5);

			this.modalClose();
		},

		// FILE
		fileShow: function ()
		{

			this.selectionSave();

			var callback = $.proxy(function()
			{
				var sel = this.getSelection();

				var text = '';
				if (this.oldIE()) text = sel.text;
				else text = sel.toString();

				$('#redactor_filename').val(text);

				// dragupload
				if (!this.isMobile() && !this.isIPad())
				{
					this.draguploadInit('#redactor_file', {
						url: this.opts.fileUpload,
						uploadFields: this.opts.uploadFields,
						success: $.proxy(this.fileCallback, this),
						error: $.proxy( function(obj, json)
						{
							this.callback('fileUploadError', json);

						}, this),
						uploadParam: this.opts.fileUploadParam
					});
				}

				this.uploadInit('redactor_file', {
					auto: true,
					url: this.opts.fileUpload,
					success: $.proxy(this.fileCallback, this),
					error: $.proxy(function(obj, json)
					{
						this.callback('fileUploadError', json);

					}, this)
				});

			}, this);

			this.modalInit(this.opts.curLang.file, this.opts.modal_file, 500, callback);
		},
		fileCallback: function(json)
		{

			this.selectionRestore();

			if (json !== false)
			{

				var text = $('#redactor_filename').val();
				if (text === '') text = json.filename;

				var link = '<a href="' + json.filelink + '" id="filelink-marker">' + text + '</a>';

				// chrome fix
				if (this.browser('webkit') && !!this.window.chrome)
				{
					link = link + '&nbsp;';
				}

				this.execCommand('inserthtml', link, false);

				var linkmarker = $(this.$editor.find('a#filelink-marker'));
				if (linkmarker.size() != 0) linkmarker.removeAttr('id');
				else linkmarker = false;

				this.sync();

				// file upload callback
				this.callback('fileUpload', linkmarker, json);
			}

			this.modalClose();
		},

		// IMAGE
		imageShow: function()
		{

			this.selectionSave();

			var callback = $.proxy(function()
			{
				// json
				if (this.opts.imageGetJson)
				{

					$.getJSON(this.opts.imageGetJson, $.proxy(function(data)
					{
						var folders = {}, count = 0;

						// folders
						$.each(data, $.proxy(function(key, val)
						{
							if (typeof val.folder !== 'undefined')
							{
								count++;
								folders[val.folder] = count;
							}

						}, this));

						var folderclass = false;
						$.each(data, $.proxy(function(key, val)
						{
							// title
							var thumbtitle = '';
							if (typeof val.title !== 'undefined') thumbtitle = val.title;

							var folderkey = 0;
							if (!$.isEmptyObject(folders) && typeof val.folder !== 'undefined')
							{
								folderkey = folders[val.folder];
								if (folderclass === false) folderclass = '.redactorfolder' + folderkey;
							}

							var img = $('<img src="' + val.thumb + '" class="redactorfolder redactorfolder' + folderkey + '" rel="' + val.image + '" title="' + thumbtitle + '" />');
							$('#redactor_image_box').append(img);
							$(img).click($.proxy(this.imageThumbClick, this));

						}, this));

						// folders
						if (!$.isEmptyObject(folders))
						{
							$('.redactorfolder').hide();
							$(folderclass).show();

							var onchangeFunc = function(e)
							{
								$('.redactorfolder').hide();
								$('.redactorfolder' + $(e.target).val()).show();
							};

							var select = $('<select id="redactor_image_box_select">');
							$.each( folders, function(k, v)
							{
								select.append( $('<option value="' + v + '">' + k + '</option>'));
							});

							$('#redactor_image_box').before(select);
							select.change(onchangeFunc);
						}
					}, this));

				}
				else
				{
					$('#redactor-tab-control-2').remove();
				}

				if (this.opts.imageUpload || this.opts.s3)
				{
					// dragupload
					if (!this.isMobile()  && !this.isIPad() && this.opts.s3 === false)
					{
						if ($('#redactor_file' ).length)
						{
							this.draguploadInit('#redactor_file', {
								url: this.opts.imageUpload,
								uploadFields: this.opts.uploadFields,
								success: $.proxy(this.imageCallback, this),
								error: $.proxy(function(obj, json)
								{
									this.callback('imageUploadError', json);

								}, this),
								uploadParam: this.opts.imageUploadParam
							});
						}
					}

					if (this.opts.s3 === false)
					{
						// ajax upload
						this.uploadInit('redactor_file', {
							auto: true,
							url: this.opts.imageUpload,
							success: $.proxy(this.imageCallback, this),
							error: $.proxy(function(obj, json)
							{
								this.callback('imageUploadError', json);

							}, this)
						});
					}
					// s3 upload
					else
					{
						$('#redactor_file').on('change.redactor', $.proxy(this.s3handleFileSelect, this));
					}

				}
				else
				{
					$('.redactor_tab').hide();
					if (!this.opts.imageGetJson)
					{
						$('#redactor_tabs').remove();
						$('#redactor_tab3').show();
					}
					else
					{
						$('#redactor-tab-control-1').remove();
						$('#redactor-tab-control-2').addClass('redactor_tabs_act');
						$('#redactor_tab2').show();
					}
				}

				if (!this.opts.imageTabLink && (this.opts.imageUpload || this.opts.imageGetJson))
				{
					$('#redactor-tab-control-3').hide();
				}

				$('#redactor_upload_btn').click($.proxy(this.imageCallbackLink, this));

				if (!this.opts.imageUpload && !this.opts.imageGetJson)
				{
					setTimeout(function()
					{
						$('#redactor_file_link').focus();

					}, 200);
				}

			}, this);

			this.modalInit(this.opts.curLang.image, this.opts.modal_image, 610, callback);

		},
		imageEdit: function(image)
		{
			var $el = image;
			var parent = $el.parent().parent();

			var callback = $.proxy(function()
			{
				$('#redactor_file_alt').val($el.attr('alt'));
				$('#redactor_image_edit_src').attr('href', $el.attr('src'));

				if ($el.css('display') == 'block' && $el.css('float') == 'none')
				{
					$('#redactor_form_image_align').val('center');
				}
				else
				{
					$('#redactor_form_image_align').val($el.css('float'));
				}

				if ($(parent).get(0).tagName === 'A')
				{
					$('#redactor_file_link').val($(parent).attr('href'));

					if ($(parent).attr('target') == '_blank')
					{
						$('#redactor_link_blank').prop('checked', true);
					}
				}

				$('#redactor_image_delete_btn').click($.proxy(function()
				{
					this.imageRemove($el);

				}, this));

				$('#redactorSaveBtn').click($.proxy(function()
				{
					this.imageSave($el);

				}, this));

			}, this);

			this.modalInit(this.opts.curLang.edit, this.opts.modal_image_edit, 380, callback);

		},
		imageRemove: function(el)
		{
			var parentLink = $(el).parent().parent();
			var parent = $(el).parent();
			var parentEl = false;

			if (parentLink.length && parentLink[0].tagName === 'A')
			{
				parentEl = true;
				$(parentLink).remove();
			}
			else if (parent.length && parent[0].tagName === 'A')
			{
				parentEl = true;
				$(parent).remove();
			}
			else
			{
				$(el).remove();
			}

			if (parent.length && parent[0].tagName === 'P')
			{
				this.focusWithSaveScroll();

				if (parentEl === false) this.selectionStart(parent);
			}

			// delete callback
			this.callback('imageDelete', el);

			this.modalClose();
			this.sync();
		},
		imageSave: function(el)
		{
			this.imageResizeHide(false);

			var $el = $(el);
			var parent = $el.parent();

			$el.attr('alt', $('#redactor_file_alt').val());

			var floating = $('#redactor_form_image_align').val();
			var margin = '';

			if (floating === 'left')
			{
				margin = '0 ' + this.opts.imageFloatMargin + ' ' + this.opts.imageFloatMargin + ' 0';
				$el.css({ 'float': 'left', 'margin': margin });
			}
			else if (floating === 'right')
			{
				margin = '0 0 ' + this.opts.imageFloatMargin + ' ' + this.opts.imageFloatMargin + '';
				$el.css({ 'float': 'right', 'margin': margin });
			}
			else if (floating === 'center')
			{
				$el.css({ 'float': '', 'display': 'block', 'margin': 'auto' });
			}
			else
			{
				$el.css({ 'float': '', 'display': '', 'margin': '' });
			}

			// as link
			var link = $.trim($('#redactor_file_link').val());
			if (link !== '')
			{
				var target = false;
				if ($('#redactor_link_blank').prop('checked'))
				{
					target = true;
				}

				if (parent.get(0).tagName !== 'A')
				{
					var a = $('<a href="' + link + '">' + this.outerHtml(el) + '</a>');

					if (target)
					{
						a.attr('target', '_blank');
					}

					$el.replaceWith(a);
				}
				else
				{
					parent.attr('href', link);
					if (target)
					{
						parent.attr('target', '_blank');
					}
					else
					{
						parent.removeAttr('target');
					}
				}
			}
			else
			{
				if (parent.get(0).tagName === 'A')
				{
					parent.replaceWith(this.outerHtml(el));
				}
			}

			this.modalClose();
			this.observeImages();
			this.sync();

		},
		imageResizeHide: function(e)
		{
			if (e !== false && $(e.target).parent().size() != 0 && $(e.target).parent()[0].id === 'redactor-image-box')
			{
				return false;
			}

			var imageBox = this.$editor.find('#redactor-image-box');
			if (imageBox.size() == 0)
			{
				return false;
			}

			this.$editor.find('#redactor-image-editter, #redactor-image-resizer').remove();

			imageBox.find('img').css({
				marginTop: imageBox[0].style.marginTop,
				marginBottom: imageBox[0].style.marginBottom,
				marginLeft: imageBox[0].style.marginLeft,
				marginRight: imageBox[0].style.marginRight
			});

			imageBox.css('margin', '');


			imageBox.find('img').css('opacity', '');
			imageBox.replaceWith(function()
			{
				return $(this).contents();
			});

			$(document).off('click.redactor-image-resize-hide');
			this.$editor.off('click.redactor-image-resize-hide');
			this.$editor.off('keydown.redactor-image-delete');

			this.sync()

		},
		imageResize: function(image)
		{
			var $image = $(image);

			$image.on('mousedown', $.proxy(function()
			{
				this.imageResizeHide(false);
			}, this));

			$image.on('dragstart', $.proxy(function()
			{
				this.$editor.on('drop.redactor-image-inside-drop', $.proxy(function()
				{
					setTimeout($.proxy(function()
					{
						this.observeImages();
						this.$editor.off('drop.redactor-image-inside-drop');
						this.sync();

					}, this), 1);

				},this));
			}, this));

			$image.on('click', $.proxy(function(e)
			{
				if (this.$editor.find('#redactor-image-box').size() != 0)
				{
					return false;
				}

				var clicked = false,
				start_x,
				start_y,
				ratio = $image.width() / $image.height(),
				min_w = 20,
				min_h = 10;

				var imageResizer = this.imageResizeControls($image);

				// resize
				var isResizing = false;
				if (imageResizer !== false)
				{
					imageResizer.on('mousedown', function(e)
					{
						isResizing = true;
						e.preventDefault();

						ratio = $image.width() / $image.height();

						start_x = Math.round(e.pageX - $image.eq(0).offset().left);
						start_y = Math.round(e.pageY - $image.eq(0).offset().top);

					});

					$(this.document.body).on('mousemove', $.proxy(function(e)
					{
						if (isResizing)
						{
							var mouse_x = Math.round(e.pageX - $image.eq(0).offset().left) - start_x;
							var mouse_y = Math.round(e.pageY - $image.eq(0).offset().top) - start_y;

							var div_h = $image.height();

							var new_h = parseInt(div_h, 10) + mouse_y;
							var new_w = Math.round(new_h * ratio);

							if (new_w > min_w)
							{
								$image.width(new_w);

								if (new_w < 100)
								{
									this.imageEditter.css({
										marginTop: '-7px',
										marginLeft: '-13px',
										fontSize: '9px',
										padding: '3px 5px'
									});
								}
								else
								{
									this.imageEditter.css({
										marginTop: '-11px',
										marginLeft: '-18px',
										fontSize: '11px',
										padding: '7px 10px'
									});
								}
							}

							start_x = Math.round(e.pageX - $image.eq(0).offset().left);
							start_y = Math.round(e.pageY - $image.eq(0).offset().top);

							this.sync()
						}
					}, this)).on('mouseup', function()
					{
						isResizing = false;
					});
				}


				this.$editor.on('keydown.redactor-image-delete', $.proxy(function(e)
				{
					var key = e.which;

					if (this.keyCode.BACKSPACE == key || this.keyCode.DELETE == key)
					{
						this.bufferSet(false);
						this.imageResizeHide(false);
						this.imageRemove($image);
					}

				}, this));

				$(document).on('click.redactor-image-resize-hide', $.proxy(this.imageResizeHide, this));
				this.$editor.on('click.redactor-image-resize-hide', $.proxy(this.imageResizeHide, this));


			}, this));
		},
		imageResizeControls: function($image)
		{
			var imageBox = $('<span id="redactor-image-box" data-redactor="verified">');
			imageBox.css({
				position: 'relative',
				display: 'inline-block',
				lineHeight: 0,
				outline: '1px dashed rgba(0, 0, 0, .6)',
				'float': $image.css('float')
			});
			imageBox.attr('contenteditable', false);

			if ($image[0].style.margin != 'auto')
			{
				imageBox.css({
					marginTop: $image[0].style.marginTop,
					marginBottom: $image[0].style.marginBottom,
					marginLeft: $image[0].style.marginLeft,
					marginRight: $image[0].style.marginRight
				});

				$image.css('margin', '');
			}
			else
			{
				imageBox.css({ 'display': 'block', 'margin': 'auto' });
			}

			$image.css('opacity', .5).after(imageBox);

			// editter
			this.imageEditter = $('<span id="redactor-image-editter" data-redactor="verified">' + this.opts.curLang.edit + '</span>');
			this.imageEditter.css({
				position: 'absolute',
				zIndex: 5,
				top: '50%',
				left: '50%',
				marginTop: '-11px',
				marginLeft: '-18px',
				lineHeight: 1,
				backgroundColor: '#000',
				color: '#fff',
				fontSize: '11px',
				padding: '7px 10px',
				cursor: 'pointer'
			});
			this.imageEditter.attr('contenteditable', false);
			this.imageEditter.on('click', $.proxy(function()
			{
				this.imageEdit($image);
			}, this));
			imageBox.append(this.imageEditter);

			// resizer
			if (this.opts.imageResizable)
			{
				var imageResizer = $('<span id="redactor-image-resizer" data-redactor="verified"></span>');
				imageResizer.css({
					position: 'absolute',
					zIndex: 2,
					lineHeight: 1,
					cursor: 'nw-resize',
					bottom: '-4px',
					right: '-5px',
					border: '1px solid #fff',
					backgroundColor: '#000',
					width: '8px',
					height: '8px'
				});
				imageResizer.attr('contenteditable', false);
				imageBox.append(imageResizer);

				imageBox.append($image);

				return imageResizer;
			}
			else
			{
				imageBox.append($image);

				return false;
			}
		},
		imageThumbClick: function(e)
		{
			var img = '<img id="image-marker" src="' + $(e.target).attr('rel') + '" alt="' + $(e.target).attr('title') + '" />';

			var parent = this.getParent();
			if (this.opts.paragraphy && $(parent).closest('li').size() == 0) img = '<p>' + img + '</p>';

			this.imageInsert(img, true);
		},
		imageCallbackLink: function()
		{
			var val = $('#redactor_file_link').val();

			if (val !== '')
			{
				var data = '<img id="image-marker" src="' + val + '" />';
				if (this.opts.linebreaks === false) data = '<p>' + data + '</p>';

				this.imageInsert(data, true);

			}
			else this.modalClose();
		},
		imageCallback: function(data)
		{
			this.imageInsert(data);
		},
		imageInsert: function(json, link)
		{
			this.selectionRestore();

			if (json !== false)
			{
				var html = '';
				if (link !== true)
				{
					html = '<img id="image-marker" src="' + json.filelink + '" />';

					var parent = this.getParent();
					if (this.opts.paragraphy && $(parent).closest('li').size() == 0)
					{
						html = '<p>' + html + '</p>';
					}
				}
				else
				{
					html = json;
				}

				this.execCommand('inserthtml', html, false);

				var image = $(this.$editor.find('img#image-marker'));

				if (image.length) image.removeAttr('id');
				else image = false;

				this.sync();

				// upload image callback
				link !== true && this.callback('imageUpload', image, json);
			}

			this.modalClose();
			this.observeImages();
		},

		// PROGRESS BAR
		buildProgressBar: function()
		{
			if ($('#redactor-progress').size() != 0) return;

			this.$progressBar = $('<div id="redactor-progress"><span></span></div>');
			$(document.body).append(this.$progressBar);
		},
		showProgressBar: function()
		{
			this.buildProgressBar();
			$('#redactor-progress').fadeIn();
		},
		hideProgressBar: function()
		{
			$('#redactor-progress').fadeOut(1500);
		},

		// MODAL
		modalTemplatesInit: function()
		{
			$.extend( this.opts,
			{
				modal_file: String()
				+ '<section id="redactor-modal-file-insert">'
					+ '<form id="redactorUploadFileForm" method="post" action="" enctype="multipart/form-data">'
						+ '<label>' + this.opts.curLang.filename + '</label>'
						+ '<input type="text" id="redactor_filename" class="redactor_input" />'
						+ '<div style="margin-top: 7px;">'
							+ '<input type="file" id="redactor_file" name="' + this.opts.fileUploadParam + '" />'
						+ '</div>'
					+ '</form>'
				+ '</section>',

				modal_image_edit: String()
				+ '<section id="redactor-modal-image-edit">'
					+ '<label>' + this.opts.curLang.title + '</label>'
					+ '<input type="text" id="redactor_file_alt" class="redactor_input" />'
					+ '<label>' + this.opts.curLang.link + '</label>'
					+ '<input type="text" id="redactor_file_link" class="redactor_input" />'
					+ '<label><input type="checkbox" id="redactor_link_blank"> ' + this.opts.curLang.link_new_tab + '</label>'
					+ '<label>' + this.opts.curLang.image_position + '</label>'
					+ '<select id="redactor_form_image_align">'
						+ '<option value="none">' + this.opts.curLang.none + '</option>'
						+ '<option value="left">' + this.opts.curLang.left + '</option>'
						+ '<option value="center">' + this.opts.curLang.center + '</option>'
						+ '<option value="right">' + this.opts.curLang.right + '</option>'
					+ '</select>'
				+ '</section>'
				+ '<footer>'
					+ '<button id="redactor_image_delete_btn" class="redactor_modal_btn redactor_modal_delete_btn">' + this.opts.curLang._delete + '</button>'
					+ '<button class="redactor_modal_btn redactor_btn_modal_close">' + this.opts.curLang.cancel + '</button>'
					+ '<button id="redactorSaveBtn" class="redactor_modal_btn redactor_modal_action_btn">' + this.opts.curLang.save + '</button>'
				+ '</footer>',

				modal_image: String()
				+ '<section id="redactor-modal-image-insert">'
					+ '<div id="redactor_tabs">'
						+ '<a href="#" id="redactor-tab-control-1" class="redactor_tabs_act">' + this.opts.curLang.upload + '</a>'
						+ '<a href="#" id="redactor-tab-control-2">' + this.opts.curLang.choose + '</a>'
						+ '<a href="#" id="redactor-tab-control-3">' + this.opts.curLang.link + '</a>'
					+ '</div>'
					+ '<form id="redactorInsertImageForm" method="post" action="" enctype="multipart/form-data">'
						+ '<div id="redactor_tab1" class="redactor_tab">'
							+ '<input type="file" id="redactor_file" name="' + this.opts.imageUploadParam + '" />'
						+ '</div>'
						+ '<div id="redactor_tab2" class="redactor_tab" style="display: none;">'
							+ '<div id="redactor_image_box"></div>'
						+ '</div>'
					+ '</form>'
					+ '<div id="redactor_tab3" class="redactor_tab" style="display: none;">'
						+ '<label>' + this.opts.curLang.image_web_link + '</label>'
						+ '<input type="text" name="redactor_file_link" id="redactor_file_link" class="redactor_input"  /><br><br>'
					+ '</div>'
				+ '</section>'
				+ '<footer>'
					+ '<button class="redactor_modal_btn redactor_btn_modal_close">' + this.opts.curLang.cancel + '</button>'
					+ '<button class="redactor_modal_btn redactor_modal_action_btn" id="redactor_upload_btn">' + this.opts.curLang.insert + '</button>'
				+ '</footer>',

				modal_link: String()
				+ '<section id="redactor-modal-link-insert">'
					+ '<select id="redactor-predefined-links" style="width: 99.5%; display: none;"></select>'
					+ '<label>URL</label>'
					+ '<input type="text" class="redactor_input" id="redactor_link_url" />'
					+ '<label>' + this.opts.curLang.text + '</label>'
					+ '<input type="text" class="redactor_input" id="redactor_link_url_text" />'
					+ '<label><input type="checkbox" id="redactor_link_blank"> ' + this.opts.curLang.link_new_tab + '</label>'
				+ '</section>'
				+ '<footer>'
					+ '<button class="redactor_modal_btn redactor_btn_modal_close">' + this.opts.curLang.cancel + '</button>'
					+ '<button id="redactor_insert_link_btn" class="redactor_modal_btn redactor_modal_action_btn">' + this.opts.curLang.insert + '</button>'
				+ '</footer>',

				modal_table: String()
				+ '<section id="redactor-modal-table-insert">'
					+ '<label>' + this.opts.curLang.rows + '</label>'
					+ '<input type="text" size="5" value="2" id="redactor_table_rows" />'
					+ '<label>' + this.opts.curLang.columns + '</label>'
					+ '<input type="text" size="5" value="3" id="redactor_table_columns" />'
				+ '</section>'
				+ '<footer>'
					+ '<button class="redactor_modal_btn redactor_btn_modal_close">' + this.opts.curLang.cancel + '</button>'
					+ '<button id="redactor_insert_table_btn" class="redactor_modal_btn redactor_modal_action_btn">' + this.opts.curLang.insert + '</button>'
				+ '</footer>',

				modal_video: String()
				+ '<section id="redactor-modal-video-insert">'
					+ '<form id="redactorInsertVideoForm">'
						+ '<label>' + this.opts.curLang.video_html_code + '</label>'
						+ '<textarea id="redactor_insert_video_area" style="width: 99%; height: 160px;"></textarea>'
					+ '</form>'
				+ '</section>'
				+ '<footer>'
					+ '<button class="redactor_modal_btn redactor_btn_modal_close">' + this.opts.curLang.cancel + '</button>'
					+ '<button id="redactor_insert_video_btn" class="redactor_modal_btn redactor_modal_action_btn">' + this.opts.curLang.insert + '</button>'
				+ '</footer>'

			});
		},
		modalInit: function(title, content, width, callback)
		{
			this.modalSetOverlay();

			this.$redactorModalWidth = width;
			this.$redactorModal = $('#redactor_modal');

			if (!this.$redactorModal.length)
			{
				this.$redactorModal = $('<div id="redactor_modal" style="display: none;" />');
				this.$redactorModal.append($('<div id="redactor_modal_close">&times;</div>'));
				this.$redactorModal.append($('<header id="redactor_modal_header" />'));
				this.$redactorModal.append($('<div id="redactor_modal_inner" />'));
				this.$redactorModal.appendTo(document.body);
			}

			$('#redactor_modal_close').on('click', $.proxy(this.modalClose, this));
			$(document).keyup($.proxy(this.modalCloseHandler, this));
			this.$editor.keyup($.proxy(this.modalCloseHandler, this));

			this.modalSetContent(content);
			this.modalSetTitle(title);
			this.modalSetDraggable();
			this.modalLoadTabs();
			this.modalOnCloseButton();
			this.modalSetButtonsWidth();

			this.saveModalScroll = this.document.body.scrollTop;
			if (this.opts.autoresize === false)
			{
				this.saveModalScroll = this.$editor.scrollTop();
			}

			if (this.isMobile() === false) this.modalShowOnDesktop();
			else this.modalShowOnMobile();

			// modal actions callback
			if (typeof callback === 'function')
			{
				callback();
			}

			// modal shown callback
			setTimeout($.proxy(function()
			{
				this.callback('modalOpened', this.$redactorModal);

			}, this), 11);

			// fix bootstrap modal focus
			$(document).off('focusin.modal');

			// enter
			this.$redactorModal.find('input[type=text]').on('keypress', $.proxy(function(e)
			{
				if (e.which === 13)
				{
					this.$redactorModal.find('.redactor_modal_action_btn').click();
					e.preventDefault();
				}
			}, this));

			return this.$redactorModal;

		},
		modalShowOnDesktop: function()
		{
			this.$redactorModal.css({
				position: 'fixed',
				top: '-2000px',
				left: '50%',
				width: this.$redactorModalWidth + 'px',
				marginLeft: '-' + (this.$redactorModalWidth / 2) + 'px'
			}).show();

			this.modalSaveBodyOveflow = $(document.body).css('overflow');
			$(document.body).css('overflow', 'hidden');

			setTimeout($.proxy(function()
			{
				var height = this.$redactorModal.outerHeight();
				this.$redactorModal.css({
					top: '50%',
					height: 'auto',
					minHeight: 'auto',
					marginTop: '-' + (height + 10) / 2 + 'px'
				});
			}, this), 15);
		},
		modalShowOnMobile: function()
		{
			this.$redactorModal.css({
				position: 'fixed',
				width: '100%',
				height: '100%',
				top: '0',
				left: '0',
				margin: '0',
				minHeight: '300px'
			}).show();
		},
		modalSetContent: function(content)
		{
			this.modalcontent = false;
			if (content.indexOf('#') == 0)
			{
				this.modalcontent = $(content);
				$('#redactor_modal_inner').empty().append(this.modalcontent.html());
				this.modalcontent.html('');

			}
			else
			{
				$('#redactor_modal_inner').empty().append(content);
			}
		},
		modalSetTitle: function(title)
		{
			this.$redactorModal.find('#redactor_modal_header').html(title);
		},
		modalSetButtonsWidth: function()
		{
			var buttons = this.$redactorModal.find('footer button').not('.redactor_modal_btn_hidden');
			var buttonsSize = buttons.size();
			if (buttonsSize > 0)
			{
				$(buttons).css('width', (this.$redactorModalWidth/buttonsSize) + 'px')
			}
		},
		modalOnCloseButton: function()
		{
			this.$redactorModal.find('.redactor_btn_modal_close').on('click', $.proxy(this.modalClose, this));
		},
		modalSetOverlay: function()
		{
			if (this.opts.modalOverlay)
			{
				this.$redactorModalOverlay = $('#redactor_modal_overlay');
				if (!this.$redactorModalOverlay.length)
				{
					this.$redactorModalOverlay = $('<div id="redactor_modal_overlay" style="display: none;"></div>');
					$('body').prepend(this.$redactorModalOverlay);
				}

				this.$redactorModalOverlay.show().on('click', $.proxy(this.modalClose, this));
			}
		},
		modalSetDraggable: function()
		{
			if (typeof $.fn.draggable !== 'undefined')
			{
				this.$redactorModal.draggable({ handle: '#redactor_modal_header' });
				this.$redactorModal.find('#redactor_modal_header').css('cursor', 'move');
			}
		},
		modalLoadTabs: function()
		{
			var $redactor_tabs = $('#redactor_tabs');
			if (!$redactor_tabs.length) return false;

			var that = this;
			$redactor_tabs.find('a').each(function(i, s)
			{
				i++;
				$(s).on('click', function(e)
				{
					e.preventDefault();

					$redactor_tabs.find('a').removeClass('redactor_tabs_act');
					$(this).addClass('redactor_tabs_act');
					$('.redactor_tab').hide();
					$('#redactor_tab' + i ).show();
					$('#redactor_tab_selected').val(i);

					if (that.isMobile() === false)
					{
						var height = that.$redactorModal.outerHeight();
						that.$redactorModal.css('margin-top', '-' + (height + 10) / 2 + 'px');
					}
				});
			});

		},
		modalCloseHandler: function(e)
		{
			if (e.keyCode === this.keyCode.ESC)
			{
				this.modalClose();
				return false;
			}
		},
		modalClose: function()
		{
			$('#redactor_modal_close').off('click', this.modalClose);
			$('#redactor_modal').fadeOut('fast', $.proxy(function()
			{
				var redactorModalInner = $('#redactor_modal_inner');

				if (this.modalcontent !== false)
				{
					this.modalcontent.html(redactorModalInner.html());
					this.modalcontent = false;
				}

				redactorModalInner.html('');

				if (this.opts.modalOverlay)
				{
					$('#redactor_modal_overlay').hide().off('click', this.modalClose);
				}

				$(document).unbind('keyup', this.hdlModalClose);
				this.$editor.unbind('keyup', this.hdlModalClose);

				this.selectionRestore();

				// restore scroll
				if (this.opts.autoresize && this.saveModalScroll)
				{
					$(this.document.body).scrollTop(this.saveModalScroll);
				}
				else if (this.opts.autoresize === false && this.saveModalScroll)
				{
					this.$editor.scrollTop(this.saveModalScroll);
				}

				this.callback('modalClosed');

			}, this));


			if (this.isMobile() === false)
			{
				$(document.body).css('overflow', this.modalSaveBodyOveflow ? this.modalSaveBodyOveflow : 'visible');
			}

			return false;
		},
		modalSetTab: function(num)
		{
			$('.redactor_tab').hide();
			$('#redactor_tabs').find('a').removeClass('redactor_tabs_act').eq(num - 1).addClass('redactor_tabs_act');
			$('#redactor_tab' + num).show();
		},

		// S3
		s3handleFileSelect: function(e)
		{
			var files = e.target.files;

			for (var i = 0, f; f = files[i]; i++)
			{
				this.s3uploadFile(f);
			}
		},
		s3uploadFile: function(file)
		{
			this.s3executeOnSignedUrl(file, $.proxy(function(signedURL)
			{
				this.s3uploadToS3(file, signedURL);
			}, this));
		},
		s3executeOnSignedUrl: function(file, callback)
		{
			var xhr = new XMLHttpRequest();

			var mark = '?';
			if (this.opts.s3.search(/\?/) != '-1') mark = '&';

			xhr.open('GET', this.opts.s3 + mark + 'name=' + file.name + '&type=' + file.type, true);

			// Hack to pass bytes through unprocessed.
			if (xhr.overrideMimeType) xhr.overrideMimeType('text/plain; charset=x-user-defined');

			var that = this;
			xhr.onreadystatechange = function(e)
			{
				if (this.readyState == 4 && this.status == 200)
				{
					that.showProgressBar();
					callback(decodeURIComponent(this.responseText));
				}
				else if(this.readyState == 4 && this.status != 200)
				{
					//setProgress(0, 'Could not contact signing script. Status = ' + this.status);
				}
			};

			xhr.send();
		},
		s3createCORSRequest: function(method, url)
		{
			var xhr = new XMLHttpRequest();
			if ("withCredentials" in xhr)
			{
				xhr.open(method, url, true);
			}
			else if (typeof XDomainRequest != "undefined")
			{
				xhr = new XDomainRequest();
				xhr.open(method, url);
			}
			else
			{
				xhr = null;
			}

			return xhr;
		},
		s3uploadToS3: function(file, url)
		{
			var xhr = this.s3createCORSRequest('PUT', url);
			if (!xhr)
			{
				//setProgress(0, 'CORS not supported');
			}
			else
			{
				xhr.onload = $.proxy(function()
				{
					if (xhr.status == 200)
					{
						//setProgress(100, 'Upload completed.');

						this.hideProgressBar();

						var s3image = url.split('?');

						if (!s3image[0])
						{
							 // url parsing is fail
							 return false;
						}

						this.selectionRestore();

						var html = '';
						html = '<img id="image-marker" src="' + s3image[0] + '" />';
						if (this.opts.paragraphy) html = '<p>' + html + '</p>';

						this.execCommand('inserthtml', html, false);

						var image = $(this.$editor.find('img#image-marker'));

						if (image.length) image.removeAttr('id');
						else image = false;

						this.sync();

						// upload image callback
						this.callback('imageUpload', image, false);

						this.modalClose();
						this.observeImages();

					}
					else
					{
						//setProgress(0, 'Upload error: ' + xhr.status);
					}
				}, this);

				xhr.onerror = function()
				{
					//setProgress(0, 'XHR error.');
				};

				xhr.upload.onprogress = function(e)
				{
					/*
					if (e.lengthComputable)
					{
						var percentLoaded = Math.round((e.loaded / e.total) * 100);
						setProgress(percentLoaded, percentLoaded == 100 ? 'Finalizing.' : 'Uploading.');
					}
					*/
				};

				xhr.setRequestHeader('Content-Type', file.type);
				xhr.setRequestHeader('x-amz-acl', 'public-read');

				xhr.send(file);
			}
		},

		// UPLOAD
		uploadInit: function(el, options)
		{
			this.uploadOptions = {
				url: false,
				success: false,
				error: false,
				start: false,
				trigger: false,
				auto: false,
				input: false
			};

			$.extend(this.uploadOptions, options);

			var $el = $('#' + el);

			// Test input or form
			if ($el.length && $el[0].tagName === 'INPUT')
			{
				this.uploadOptions.input = $el;
				this.el = $($el[0].form);
			}
			else this.el = $el;

			this.element_action = this.el.attr('action');

			// Auto or trigger
			if (this.uploadOptions.auto)
			{
				$(this.uploadOptions.input).change($.proxy(function(e)
				{
					this.el.submit(function(e)
					{
						return false;
					});

					this.uploadSubmit(e);

				}, this));

			}
			else if (this.uploadOptions.trigger)
			{
				$('#' + this.uploadOptions.trigger).click($.proxy(this.uploadSubmit, this));
			}
		},
		uploadSubmit: function(e)
		{
			this.showProgressBar();
			this.uploadForm(this.element, this.uploadFrame());
		},
		uploadFrame: function()
		{
			this.id = 'f' + Math.floor(Math.random() * 99999);

			var d = this.document.createElement('div');
			var iframe = '<iframe style="display:none" id="' + this.id + '" name="' + this.id + '"></iframe>';

			d.innerHTML = iframe;
			$(d).appendTo("body");

			// Start
			if (this.uploadOptions.start) this.uploadOptions.start();

			$( '#' + this.id ).load($.proxy(this.uploadLoaded, this));

			return this.id;
		},
		uploadForm: function(f, name)
		{
			if (this.uploadOptions.input)
			{
				var formId = 'redactorUploadForm' + this.id,
					fileId = 'redactorUploadFile' + this.id;

				this.form = $('<form  action="' + this.uploadOptions.url + '" method="POST" target="' + name + '" name="' + formId + '" id="' + formId + '" enctype="multipart/form-data" />');

				// append hidden fields
				if (this.opts.uploadFields !== false && typeof this.opts.uploadFields === 'object')
				{
					$.each(this.opts.uploadFields, $.proxy(function(k, v)
					{
						if (v != null && v.toString().indexOf('#') === 0) v = $(v).val();

						var hidden = $('<input/>', {
							'type': "hidden",
							'name': k,
							'value': v
						});

						$(this.form).append(hidden);

					}, this));
				}

				var oldElement = this.uploadOptions.input;
				var newElement = $(oldElement).clone();

				$(oldElement).attr('id', fileId).before(newElement).appendTo(this.form);

				$(this.form).css('position', 'absolute')
						.css('top', '-2000px')
						.css('left', '-2000px')
						.appendTo('body');

				this.form.submit();

			}
			else
			{
				f.attr('target', name)
					.attr('method', 'POST')
					.attr('enctype', 'multipart/form-data')
					.attr('action', this.uploadOptions.url);

				this.element.submit();
			}
		},
		uploadLoaded: function()
		{
			var i = $( '#' + this.id)[0], d;

			if (i.contentDocument) d = i.contentDocument;
			else if (i.contentWindow) d = i.contentWindow.document;
			else d = window.frames[this.id].document;

			// Success
			if (this.uploadOptions.success)
			{
				this.hideProgressBar();

				if (typeof d !== 'undefined')
				{
					// Remove bizarre <pre> tag wrappers around our json data:
					var rawString = d.body.innerHTML;
					var jsonString = rawString.match(/\{(.|\n)*\}/)[0];

					jsonString = jsonString.replace(/^\[/, '');
					jsonString = jsonString.replace(/\]$/, '');

					var json = $.parseJSON(jsonString);

					if (typeof json.error == 'undefined') this.uploadOptions.success(json);
					else
					{
						this.uploadOptions.error(this, json);
						this.modalClose();
					}
				}
				else
				{
					this.modalClose();
					alert('Upload failed!');
				}
			}

			this.el.attr('action', this.element_action);
			this.el.attr('target', '');
		},

		// DRAGUPLOAD
		draguploadInit: function (el, options)
		{
			this.draguploadOptions = $.extend({
				url: false,
				success: false,
				error: false,
				preview: false,
				uploadFields: false,
				text: this.opts.curLang.drop_file_here,
				atext: this.opts.curLang.or_choose,
				uploadParam: false
			}, options);

			if (window.FormData === undefined) return false;

			this.droparea = $('<div class="redactor_droparea"></div>');
			this.dropareabox = $('<div class="redactor_dropareabox">' + this.draguploadOptions.text + '</div>');
			this.dropalternative = $('<div class="redactor_dropalternative">' + this.draguploadOptions.atext + '</div>');

			this.droparea.append(this.dropareabox);

			$(el).before(this.droparea);
			$(el).before(this.dropalternative);

			// drag over
			this.dropareabox.on('dragover', $.proxy(function()
			{
				return this.draguploadOndrag();

			}, this));

			// drag leave
			this.dropareabox.on('dragleave', $.proxy(function()
			{
				return this.draguploadOndragleave();

			}, this));

			// drop
			this.dropareabox.get(0).ondrop = $.proxy(function(e)
			{
				e.preventDefault();

				this.dropareabox.removeClass('hover').addClass('drop');
				this.showProgressBar();
				this.dragUploadAjax(this.draguploadOptions.url, e.dataTransfer.files[0], false, e, this.draguploadOptions.uploadParam);

			}, this );
		},
		dragUploadAjax: function(url, file, directupload, e, uploadParam)
		{
			if (!directupload)
			{
				var xhr = $.ajaxSettings.xhr();
				if (xhr.upload)
				{
					xhr.upload.addEventListener('progress', $.proxy(this.uploadProgress, this), false);
				}

				$.ajaxSetup({
				  xhr: function () { return xhr; }
				});
			}

			// drop callback
			this.callback('drop', e);

			var fd = new FormData();

			// append file data
			if (uploadParam !== false)
			{
				fd.append(uploadParam, file);
			}
			else
			{
				fd.append('file', file);
			}

			// append hidden fields
			if (this.opts.uploadFields !== false && typeof this.opts.uploadFields === 'object')
			{
				$.each(this.opts.uploadFields, $.proxy(function(k, v)
				{
					if (v != null && v.toString().indexOf('#') === 0) v = $(v).val();
					fd.append(k, v);

				}, this));
			}

			$.ajax({
				url: url,
				dataType: 'html',
				data: fd,
				cache: false,
				contentType: false,
				processData: false,
				type: 'POST',
				success: $.proxy(function(data)
				{
					data = data.replace(/^\[/, '');
					data = data.replace(/\]$/, '');

					var json = (typeof data === 'string' ? $.parseJSON(data) : data);

					this.hideProgressBar();

					if (directupload)
					{
					    var $img = $('<img>');
						$img.attr('src', json.filelink).attr('id', 'drag-image-marker');

						this.insertNodeToCaretPositionFromPoint(e, $img[0]);

						var image = $(this.$editor.find('img#drag-image-marker'));
						if (image.length) image.removeAttr('id');
						else image = false;

						this.sync();
						this.observeImages();

						// upload callback
						if (image) this.callback('imageUpload', image, json);

						// error callback
						if (typeof json.error !== 'undefined') this.callback('imageUploadError', json);
					}
					else
					{
						if (typeof json.error == 'undefined')
						{
							this.draguploadOptions.success(json);
						}
						else
						{
							this.draguploadOptions.error(this, json);
							this.draguploadOptions.success(false);
						}
					}

				}, this)
			});
		},
		draguploadOndrag: function()
		{
			this.dropareabox.addClass('hover');
			return false;
		},
		draguploadOndragleave: function()
		{
			this.dropareabox.removeClass('hover');
			return false;
		},
		uploadProgress: function(e, text)
		{
			var percent = e.loaded ? parseInt(e.loaded / e.total * 100, 10) : e;
			this.dropareabox.text('Loading ' + percent + '% ' + (text || ''));
		},

		// UTILS
		isMobile: function()
		{
			return /(iPhone|iPod|BlackBerry|Android)/.test(navigator.userAgent);
		},
		isIPad: function()
		{
			return /iPad/.test(navigator.userAgent);
		},
		normalize: function(str)
		{
			if (typeof(str) === 'undefined') return 0;
			return parseInt(str.replace('px',''), 10);
		},
		outerHtml: function(el)
		{
			return $('<div>').append($(el).eq(0).clone()).html();
		},
		stripHtml: function(html)
		{
			var tmp = document.createElement("DIV");
			tmp.innerHTML = html;
			return tmp.textContent || tmp.innerText || "";
		},
		isString: function(obj)
		{
			return Object.prototype.toString.call(obj) == '[object String]';
		},
		isEmpty: function(html)
		{
			html = html.replace(/&#x200b;|<br>|<br\/>|&nbsp;/gi, '');
			html = html.replace(/\s/g, '');
			html = html.replace(/^<p>[^\W\w\D\d]*?<\/p>$/i, '');

			return html == '';
		},
		getInternetExplorerVersion: function()
		{
			var rv = false;
			if (navigator.appName == 'Microsoft Internet Explorer')
			{
				var ua = navigator.userAgent;
				var re  = new RegExp("MSIE ([0-9]{1,}[\.0-9]{0,})");
				if (re.exec(ua) != null)
				{
					rv = parseFloat(RegExp.$1);
				}
			}

			return rv;
		},
		isIe11: function()
		{
			return !!navigator.userAgent.match(/Trident\/7\./);
		},
		browser: function(browser)
		{
			var ua = navigator.userAgent.toLowerCase();
			var match = /(opr)[\/]([\w.]+)/.exec( ua ) ||
            /(chrome)[ \/]([\w.]+)/.exec( ua ) ||
            /(webkit)[ \/]([\w.]+).*(safari)[ \/]([\w.]+)/.exec(ua) ||
            /(webkit)[ \/]([\w.]+)/.exec( ua ) ||
            /(opera)(?:.*version|)[ \/]([\w.]+)/.exec( ua ) ||
            /(msie) ([\w.]+)/.exec( ua ) ||
            ua.indexOf("trident") >= 0 && /(rv)(?::| )([\w.]+)/.exec( ua ) ||
            ua.indexOf("compatible") < 0 && /(mozilla)(?:.*? rv:([\w.]+)|)/.exec( ua ) ||
            [];

			if (browser == 'version') return match[2];
			if (browser == 'webkit') return (match[1] == 'chrome' || match[1] == 'webkit');
			if (match[1] == 'rv') return browser == 'msie';
			if (match[1] == 'opr') return browser == 'webkit';

			return browser == match[1];

		},
		oldIE: function()
		{
			if (this.browser('msie') && parseInt(this.browser('version'), 10) < 9) return true;
			return false;
		},
		getFragmentHtml: function (fragment)
		{
			var cloned = fragment.cloneNode(true);
			var div = this.document.createElement('div');

			div.appendChild(cloned);
			return div.innerHTML;
		},
		extractContent: function()
		{
			var node = this.$editor[0];
			var frag = this.document.createDocumentFragment();
			var child;

			while ((child = node.firstChild))
			{
				frag.appendChild(child);
			}

			return frag;
		},
		isParentRedactor: function(el)
		{
			if (!el) return false;
			if (this.opts.iframe) return el;

			if ($(el).parents('div.redactor_editor').length == 0 || $(el).hasClass('redactor_editor')) return false;
			else return el;
		},
		currentOrParentIs: function(tagName)
		{
			var parent = this.getParent(), current = this.getCurrent();
			return parent && parent.tagName === tagName ? parent : current && current.tagName === tagName ? current : false;
		},
		isEndOfElement: function()
		{
			var current = this.getBlock();
			var offset = this.getCaretOffset(current);

			var text = $.trim($(current).text()).replace(/\n\r\n/g, '');

			var len = text.length;

			if (offset == len) return true;
			else return false;
		},
		isFocused: function()
		{
			var el, sel = this.getSelection();

			if (sel && sel.rangeCount && sel.rangeCount > 0) el = sel.getRangeAt(0).startContainer;
			if (!el) return false;
			if (this.opts.iframe)
			{
				if (this.getCaretOffsetRange().equals()) return !this.$editor.is(el);
				else return true;
			}

			return $(el).closest('div.redactor_editor').length != 0;
		},
		removeEmptyAttr: function (el, attr)
		{
			if ($(el).attr(attr) == '') $(el).removeAttr(attr);
		},
		removeFromArrayByValue: function(array, value)
		{
			var index = null;

			while ((index = array.indexOf(value)) !== -1)
			{
				array.splice(index, 1);
			}

			return array;
		}

	};

	// constructor
	Redactor.prototype.init.prototype = Redactor.prototype;

	// LINKIFY
	$.Redactor.fn.formatLinkify = function(protocol, convertLinks, convertImageLinks, convertVideoLinks, linkSize)
	{
		var url = /(((https?|ftps?):\/\/)|www[.][^\s])(.+?\..+?)([.),]?)(\s|\.\s+|\)|$)/gi,
			rProtocol = /(https?|ftp):\/\//i,
			urlImage = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif))/gi;

		var childNodes = (this.$editor ? this.$editor.get(0) : this).childNodes, i = childNodes.length;
		while (i--)
		{
			var n = childNodes[i];
			if (n.nodeType === 3)
			{
				var html = n.nodeValue;

				// youtube & vimeo
				if (convertVideoLinks && html)
				{
					var iframeStart = '<iframe width="500" height="281" src="',
						iframeEnd = '" frameborder="0" allowfullscreen></iframe>';

					if (html.match(reUrlYoutube))
					{
						html = html.replace(reUrlYoutube, iframeStart + '//www.youtube.com/embed/$1' + iframeEnd);
						$(n).after(html).remove();
					}
					else if (html.match(reUrlVimeo))
					{
						html = html.replace(reUrlVimeo, iframeStart + '//player.vimeo.com/video/$2' + iframeEnd);
						$(n).after(html).remove();
					}
				}

				// image
				if (convertImageLinks && html && html.match(urlImage))
				{
					html = html.replace(urlImage, '<img src="$1">');

					$(n).after(html).remove();
				}

				// link
				if (convertLinks && html && html.match(url))
				{
					var matches = html.match(url);

					for (var i in matches)
					{
						var href = matches[i];
						var text = href;

						var space = '';
						if (href.match(/\s$/) !== null) space = ' ';

						var addProtocol = protocol;
						if (href.match(rProtocol) !== null) addProtocol = '';

						if (text.length > linkSize) text = text.substring(0, linkSize) + '...';

						text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

						/*
							To handle URLs which may have $ characters in them, need to escape $ -> $$ to prevent $1 from getting treated as a backreference.
							See http://gotofritz.net/blog/code-snippets/escaping-in-replace-strings-in-javascript/
						*/
						var escapedBackReferences = text.replace('$', '$$$');

						html = html.replace(href, '<a href=\"' + addProtocol + $.trim(href) + '\">' + $.trim(escapedBackReferences) + '</a>' + space);
					}

					$(n).after(html).remove();
				}
			}
			else if (n.nodeType === 1 && !/^(a|button|textarea)$/i.test(n.tagName))
			{
				$.Redactor.fn.formatLinkify.call(n, protocol, convertLinks, convertImageLinks, convertVideoLinks, linkSize);
			}
		}
	};

})(jQuery);
/*
 * JavaScript MD5 1.0.1
 * https://github.com/blueimp/JavaScript-MD5
 *
 * Copyright 2011, Sebastian Tschan
 * https://blueimp.net
 *
 * Licensed under the MIT license:
 * http://www.opensource.org/licenses/MIT
 * 
 * Based on
 * A JavaScript implementation of the RSA Data Security, Inc. MD5 Message
 * Digest Algorithm, as defined in RFC 1321.
 * Version 2.2 Copyright (C) Paul Johnston 1999 - 2009
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for more info.
 */

/*jslint bitwise: true */
/*global unescape, define */

(function ($) {
    'use strict';

    /*
    * Add integers, wrapping at 2^32. This uses 16-bit operations internally
    * to work around bugs in some JS interpreters.
    */
    function safe_add(x, y) {
        var lsw = (x & 0xFFFF) + (y & 0xFFFF),
            msw = (x >> 16) + (y >> 16) + (lsw >> 16);
        return (msw << 16) | (lsw & 0xFFFF);
    }

    /*
    * Bitwise rotate a 32-bit number to the left.
    */
    function bit_rol(num, cnt) {
        return (num << cnt) | (num >>> (32 - cnt));
    }

    /*
    * These functions implement the four basic operations the algorithm uses.
    */
    function md5_cmn(q, a, b, x, s, t) {
        return safe_add(bit_rol(safe_add(safe_add(a, q), safe_add(x, t)), s), b);
    }
    function md5_ff(a, b, c, d, x, s, t) {
        return md5_cmn((b & c) | ((~b) & d), a, b, x, s, t);
    }
    function md5_gg(a, b, c, d, x, s, t) {
        return md5_cmn((b & d) | (c & (~d)), a, b, x, s, t);
    }
    function md5_hh(a, b, c, d, x, s, t) {
        return md5_cmn(b ^ c ^ d, a, b, x, s, t);
    }
    function md5_ii(a, b, c, d, x, s, t) {
        return md5_cmn(c ^ (b | (~d)), a, b, x, s, t);
    }

    /*
    * Calculate the MD5 of an array of little-endian words, and a bit length.
    */
    function binl_md5(x, len) {
        /* append padding */
        x[len >> 5] |= 0x80 << (len % 32);
        x[(((len + 64) >>> 9) << 4) + 14] = len;

        var i, olda, oldb, oldc, oldd,
            a =  1732584193,
            b = -271733879,
            c = -1732584194,
            d =  271733878;

        for (i = 0; i < x.length; i += 16) {
            olda = a;
            oldb = b;
            oldc = c;
            oldd = d;

            a = md5_ff(a, b, c, d, x[i],       7, -680876936);
            d = md5_ff(d, a, b, c, x[i +  1], 12, -389564586);
            c = md5_ff(c, d, a, b, x[i +  2], 17,  606105819);
            b = md5_ff(b, c, d, a, x[i +  3], 22, -1044525330);
            a = md5_ff(a, b, c, d, x[i +  4],  7, -176418897);
            d = md5_ff(d, a, b, c, x[i +  5], 12,  1200080426);
            c = md5_ff(c, d, a, b, x[i +  6], 17, -1473231341);
            b = md5_ff(b, c, d, a, x[i +  7], 22, -45705983);
            a = md5_ff(a, b, c, d, x[i +  8],  7,  1770035416);
            d = md5_ff(d, a, b, c, x[i +  9], 12, -1958414417);
            c = md5_ff(c, d, a, b, x[i + 10], 17, -42063);
            b = md5_ff(b, c, d, a, x[i + 11], 22, -1990404162);
            a = md5_ff(a, b, c, d, x[i + 12],  7,  1804603682);
            d = md5_ff(d, a, b, c, x[i + 13], 12, -40341101);
            c = md5_ff(c, d, a, b, x[i + 14], 17, -1502002290);
            b = md5_ff(b, c, d, a, x[i + 15], 22,  1236535329);

            a = md5_gg(a, b, c, d, x[i +  1],  5, -165796510);
            d = md5_gg(d, a, b, c, x[i +  6],  9, -1069501632);
            c = md5_gg(c, d, a, b, x[i + 11], 14,  643717713);
            b = md5_gg(b, c, d, a, x[i],      20, -373897302);
            a = md5_gg(a, b, c, d, x[i +  5],  5, -701558691);
            d = md5_gg(d, a, b, c, x[i + 10],  9,  38016083);
            c = md5_gg(c, d, a, b, x[i + 15], 14, -660478335);
            b = md5_gg(b, c, d, a, x[i +  4], 20, -405537848);
            a = md5_gg(a, b, c, d, x[i +  9],  5,  568446438);
            d = md5_gg(d, a, b, c, x[i + 14],  9, -1019803690);
            c = md5_gg(c, d, a, b, x[i +  3], 14, -187363961);
            b = md5_gg(b, c, d, a, x[i +  8], 20,  1163531501);
            a = md5_gg(a, b, c, d, x[i + 13],  5, -1444681467);
            d = md5_gg(d, a, b, c, x[i +  2],  9, -51403784);
            c = md5_gg(c, d, a, b, x[i +  7], 14,  1735328473);
            b = md5_gg(b, c, d, a, x[i + 12], 20, -1926607734);

            a = md5_hh(a, b, c, d, x[i +  5],  4, -378558);
            d = md5_hh(d, a, b, c, x[i +  8], 11, -2022574463);
            c = md5_hh(c, d, a, b, x[i + 11], 16,  1839030562);
            b = md5_hh(b, c, d, a, x[i + 14], 23, -35309556);
            a = md5_hh(a, b, c, d, x[i +  1],  4, -1530992060);
            d = md5_hh(d, a, b, c, x[i +  4], 11,  1272893353);
            c = md5_hh(c, d, a, b, x[i +  7], 16, -155497632);
            b = md5_hh(b, c, d, a, x[i + 10], 23, -1094730640);
            a = md5_hh(a, b, c, d, x[i + 13],  4,  681279174);
            d = md5_hh(d, a, b, c, x[i],      11, -358537222);
            c = md5_hh(c, d, a, b, x[i +  3], 16, -722521979);
            b = md5_hh(b, c, d, a, x[i +  6], 23,  76029189);
            a = md5_hh(a, b, c, d, x[i +  9],  4, -640364487);
            d = md5_hh(d, a, b, c, x[i + 12], 11, -421815835);
            c = md5_hh(c, d, a, b, x[i + 15], 16,  530742520);
            b = md5_hh(b, c, d, a, x[i +  2], 23, -995338651);

            a = md5_ii(a, b, c, d, x[i],       6, -198630844);
            d = md5_ii(d, a, b, c, x[i +  7], 10,  1126891415);
            c = md5_ii(c, d, a, b, x[i + 14], 15, -1416354905);
            b = md5_ii(b, c, d, a, x[i +  5], 21, -57434055);
            a = md5_ii(a, b, c, d, x[i + 12],  6,  1700485571);
            d = md5_ii(d, a, b, c, x[i +  3], 10, -1894986606);
            c = md5_ii(c, d, a, b, x[i + 10], 15, -1051523);
            b = md5_ii(b, c, d, a, x[i +  1], 21, -2054922799);
            a = md5_ii(a, b, c, d, x[i +  8],  6,  1873313359);
            d = md5_ii(d, a, b, c, x[i + 15], 10, -30611744);
            c = md5_ii(c, d, a, b, x[i +  6], 15, -1560198380);
            b = md5_ii(b, c, d, a, x[i + 13], 21,  1309151649);
            a = md5_ii(a, b, c, d, x[i +  4],  6, -145523070);
            d = md5_ii(d, a, b, c, x[i + 11], 10, -1120210379);
            c = md5_ii(c, d, a, b, x[i +  2], 15,  718787259);
            b = md5_ii(b, c, d, a, x[i +  9], 21, -343485551);

            a = safe_add(a, olda);
            b = safe_add(b, oldb);
            c = safe_add(c, oldc);
            d = safe_add(d, oldd);
        }
        return [a, b, c, d];
    }

    /*
    * Convert an array of little-endian words to a string
    */
    function binl2rstr(input) {
        var i,
            output = '';
        for (i = 0; i < input.length * 32; i += 8) {
            output += String.fromCharCode((input[i >> 5] >>> (i % 32)) & 0xFF);
        }
        return output;
    }

    /*
    * Convert a raw string to an array of little-endian words
    * Characters >255 have their high-byte silently ignored.
    */
    function rstr2binl(input) {
        var i,
            output = [];
        output[(input.length >> 2) - 1] = undefined;
        for (i = 0; i < output.length; i += 1) {
            output[i] = 0;
        }
        for (i = 0; i < input.length * 8; i += 8) {
            output[i >> 5] |= (input.charCodeAt(i / 8) & 0xFF) << (i % 32);
        }
        return output;
    }

    /*
    * Calculate the MD5 of a raw string
    */
    function rstr_md5(s) {
        return binl2rstr(binl_md5(rstr2binl(s), s.length * 8));
    }

    /*
    * Calculate the HMAC-MD5, of a key and some data (raw strings)
    */
    function rstr_hmac_md5(key, data) {
        var i,
            bkey = rstr2binl(key),
            ipad = [],
            opad = [],
            hash;
        ipad[15] = opad[15] = undefined;
        if (bkey.length > 16) {
            bkey = binl_md5(bkey, key.length * 8);
        }
        for (i = 0; i < 16; i += 1) {
            ipad[i] = bkey[i] ^ 0x36363636;
            opad[i] = bkey[i] ^ 0x5C5C5C5C;
        }
        hash = binl_md5(ipad.concat(rstr2binl(data)), 512 + data.length * 8);
        return binl2rstr(binl_md5(opad.concat(hash), 512 + 128));
    }

    /*
    * Convert a raw string to a hex string
    */
    function rstr2hex(input) {
        var hex_tab = '0123456789abcdef',
            output = '',
            x,
            i;
        for (i = 0; i < input.length; i += 1) {
            x = input.charCodeAt(i);
            output += hex_tab.charAt((x >>> 4) & 0x0F) +
                hex_tab.charAt(x & 0x0F);
        }
        return output;
    }

    /*
    * Encode a string as utf-8
    */
    function str2rstr_utf8(input) {
        return unescape(encodeURIComponent(input));
    }

    /*
    * Take string arguments and return either raw or hex encoded strings
    */
    function raw_md5(s) {
        return rstr_md5(str2rstr_utf8(s));
    }
    function hex_md5(s) {
        return rstr2hex(raw_md5(s));
    }
    function raw_hmac_md5(k, d) {
        return rstr_hmac_md5(str2rstr_utf8(k), str2rstr_utf8(d));
    }
    function hex_hmac_md5(k, d) {
        return rstr2hex(raw_hmac_md5(k, d));
    }

    function md5(string, key, raw) {
        if (!key) {
            if (!raw) {
                return hex_md5(string);
            }
            return raw_md5(string);
        }
        if (!raw) {
            return hex_hmac_md5(key, string);
        }
        return raw_hmac_md5(key, string);
    }

    if (typeof define === 'function' && define.amd) {
        define(function () {
            return md5;
        });
    } else {
        $.md5 = md5;
    }
}(this));

/*
 * ----------------------------- JSTORAGE -------------------------------------
 * Simple local storage wrapper to save data on the browser side, supporting
 * all major browsers - IE6+, Firefox2+, Safari4+, Chrome4+ and Opera 10.5+
 *
 * Author: Andris Reinman, andris.reinman@gmail.com
 * Project homepage: www.jstorage.info
 *
 * Licensed under Unlicense:
 *
 * This is free and unencumbered software released into the public domain.
 *
 * Anyone is free to copy, modify, publish, use, compile, sell, or
 * distribute this software, either in source code form or as a compiled
 * binary, for any purpose, commercial or non-commercial, and by any
 * means.
 *
 * In jurisdictions that recognize copyright laws, the author or authors
 * of this software dedicate any and all copyright interest in the
 * software to the public domain. We make this dedication for the benefit
 * of the public at large and to the detriment of our heirs and
 * successors. We intend this dedication to be an overt act of
 * relinquishment in perpetuity of all present and future rights to this
 * software under copyright law.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
 * OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 *
 * For more information, please refer to <http://unlicense.org/>
 */

(function() {
    'use strict';

    var
    /* jStorage version */
        JSTORAGE_VERSION = '0.4.10',

        /* detect a dollar object or create one if not found */
        $ = window.jQuery || window.$ || (window.$ = {}),

        /* check for a JSON handling support */
        JSON = {
            parse: window.JSON && (window.JSON.parse || window.JSON.decode) ||
                String.prototype.evalJSON && function(str) {
                    return String(str).evalJSON();
            } ||
                $.parseJSON ||
                $.evalJSON,
            stringify: Object.toJSON ||
                window.JSON && (window.JSON.stringify || window.JSON.encode) ||
                $.toJSON
        };

    // Break if no JSON support was found
    if (!('parse' in JSON) || !('stringify' in JSON)) {
        throw new Error('No JSON support found, include //cdnjs.cloudflare.com/ajax/libs/json2/20110223/json2.js to page');
    }

    var
    /* This is the object, that holds the cached values */
        _storage = {
            __jstorage_meta: {
                CRC32: {}
            }
        },

        /* Actual browser storage (localStorage or globalStorage['domain']) */
        _storage_service = {
            jStorage: '{}'
        },

        /* DOM element for older IE versions, holds userData behavior */
        _storage_elm = null,

        /* How much space does the storage take */
        _storage_size = 0,

        /* which backend is currently used */
        _backend = false,

        /* onchange observers */
        _observers = {},

        /* timeout to wait after onchange event */
        _observer_timeout = false,

        /* last update time */
        _observer_update = 0,

        /* pubsub observers */
        _pubsub_observers = {},

        /* skip published items older than current timestamp */
        _pubsub_last = +new Date(),

        /* Next check for TTL */
        _ttl_timeout,

        /**
         * XML encoding and decoding as XML nodes can't be JSON'ized
         * XML nodes are encoded and decoded if the node is the value to be saved
         * but not if it's as a property of another object
         * Eg. -
         *   $.jStorage.set('key', xmlNode);        // IS OK
         *   $.jStorage.set('key', {xml: xmlNode}); // NOT OK
         */
        _XMLService = {

            /**
             * Validates a XML node to be XML
             * based on jQuery.isXML function
             */
            isXML: function(elm) {
                var documentElement = (elm ? elm.ownerDocument || elm : 0).documentElement;
                return documentElement ? documentElement.nodeName !== 'HTML' : false;
            },

            /**
             * Encodes a XML node to string
             * based on http://www.mercurytide.co.uk/news/article/issues-when-working-ajax/
             */
            encode: function(xmlNode) {
                if (!this.isXML(xmlNode)) {
                    return false;
                }
                try { // Mozilla, Webkit, Opera
                    return new XMLSerializer().serializeToString(xmlNode);
                } catch (E1) {
                    try { // IE
                        return xmlNode.xml;
                    } catch (E2) {}
                }
                return false;
            },

            /**
             * Decodes a XML node from string
             * loosely based on http://outwestmedia.com/jquery-plugins/xmldom/
             */
            decode: function(xmlString) {
                var dom_parser = ('DOMParser' in window && (new DOMParser()).parseFromString) ||
                    (window.ActiveXObject && function(_xmlString) {
                        var xml_doc = new ActiveXObject('Microsoft.XMLDOM');
                        xml_doc.async = 'false';
                        xml_doc.loadXML(_xmlString);
                        return xml_doc;
                    }),
                    resultXML;
                if (!dom_parser) {
                    return false;
                }
                resultXML = dom_parser.call('DOMParser' in window && (new DOMParser()) || window, xmlString, 'text/xml');
                return this.isXML(resultXML) ? resultXML : false;
            }
        };


    ////////////////////////// PRIVATE METHODS ////////////////////////

    /**
     * Initialization function. Detects if the browser supports DOM Storage
     * or userData behavior and behaves accordingly.
     */
    function _init() {
        /* Check if browser supports localStorage */
        var localStorageReallyWorks = false;
        if ('localStorage' in window) {
            try {
                window.localStorage.setItem('_tmptest', 'tmpval');
                localStorageReallyWorks = true;
                window.localStorage.removeItem('_tmptest');
            } catch (BogusQuotaExceededErrorOnIos5) {
                // Thanks be to iOS5 Private Browsing mode which throws
                // QUOTA_EXCEEDED_ERRROR DOM Exception 22.
            }
        }

        if (localStorageReallyWorks) {
            try {
                if (window.localStorage) {
                    _storage_service = window.localStorage;
                    _backend = 'localStorage';
                    _observer_update = _storage_service.jStorage_update;
                }
            } catch (E3) { /* Firefox fails when touching localStorage and cookies are disabled */ }
        }
        /* Check if browser supports globalStorage */
        else if ('globalStorage' in window) {
            try {
                if (window.globalStorage) {
                    if (window.location.hostname == 'localhost') {
                        _storage_service = window.globalStorage['localhost.localdomain'];
                    } else {
                        _storage_service = window.globalStorage[window.location.hostname];
                    }
                    _backend = 'globalStorage';
                    _observer_update = _storage_service.jStorage_update;
                }
            } catch (E4) { /* Firefox fails when touching localStorage and cookies are disabled */ }
        }
        /* Check if browser supports userData behavior */
        else {
            _storage_elm = document.createElement('link');
            if (_storage_elm.addBehavior) {

                /* Use a DOM element to act as userData storage */
                _storage_elm.style.behavior = 'url(#default#userData)';

                /* userData element needs to be inserted into the DOM! */
                document.getElementsByTagName('head')[0].appendChild(_storage_elm);

                try {
                    _storage_elm.load('jStorage');
                } catch (E) {
                    // try to reset cache
                    _storage_elm.setAttribute('jStorage', '{}');
                    _storage_elm.save('jStorage');
                    _storage_elm.load('jStorage');
                }

                var data = '{}';
                try {
                    data = _storage_elm.getAttribute('jStorage');
                } catch (E5) {}

                try {
                    _observer_update = _storage_elm.getAttribute('jStorage_update');
                } catch (E6) {}

                _storage_service.jStorage = data;
                _backend = 'userDataBehavior';
            } else {
                _storage_elm = null;
                return;
            }
        }

        // Load data from storage
        _load_storage();

        // remove dead keys
        _handleTTL();

        // start listening for changes
        _setupObserver();

        // initialize publish-subscribe service
        _handlePubSub();

        // handle cached navigation
        if ('addEventListener' in window) {
            window.addEventListener('pageshow', function(event) {
                if (event.persisted) {
                    _storageObserver();
                }
            }, false);
        }
    }

    /**
     * Reload data from storage when needed
     */
    function _reloadData() {
        var data = '{}';

        if (_backend == 'userDataBehavior') {
            _storage_elm.load('jStorage');

            try {
                data = _storage_elm.getAttribute('jStorage');
            } catch (E5) {}

            try {
                _observer_update = _storage_elm.getAttribute('jStorage_update');
            } catch (E6) {}

            _storage_service.jStorage = data;
        }

        _load_storage();

        // remove dead keys
        _handleTTL();

        _handlePubSub();
    }

    /**
     * Sets up a storage change observer
     */
    function _setupObserver() {
        if (_backend == 'localStorage' || _backend == 'globalStorage') {
            if ('addEventListener' in window) {
                window.addEventListener('storage', _storageObserver, false);
            } else {
                document.attachEvent('onstorage', _storageObserver);
            }
        } else if (_backend == 'userDataBehavior') {
            setInterval(_storageObserver, 1000);
        }
    }

    /**
     * Fired on any kind of data change, needs to check if anything has
     * really been changed
     */
    function _storageObserver() {
        var updateTime;
        // cumulate change notifications with timeout
        clearTimeout(_observer_timeout);
        _observer_timeout = setTimeout(function() {

            if (_backend == 'localStorage' || _backend == 'globalStorage') {
                updateTime = _storage_service.jStorage_update;
            } else if (_backend == 'userDataBehavior') {
                _storage_elm.load('jStorage');
                try {
                    updateTime = _storage_elm.getAttribute('jStorage_update');
                } catch (E5) {}
            }

            if (updateTime && updateTime != _observer_update) {
                _observer_update = updateTime;
                _checkUpdatedKeys();
            }

        }, 25);
    }

    /**
     * Reloads the data and checks if any keys are changed
     */
    function _checkUpdatedKeys() {
        var oldCrc32List = JSON.parse(JSON.stringify(_storage.__jstorage_meta.CRC32)),
            newCrc32List;

        _reloadData();
        newCrc32List = JSON.parse(JSON.stringify(_storage.__jstorage_meta.CRC32));

        var key,
            updated = [],
            removed = [];

        for (key in oldCrc32List) {
            if (oldCrc32List.hasOwnProperty(key)) {
                if (!newCrc32List[key]) {
                    removed.push(key);
                    continue;
                }
                if (oldCrc32List[key] != newCrc32List[key] && String(oldCrc32List[key]).substr(0, 2) == '2.') {
                    updated.push(key);
                }
            }
        }

        for (key in newCrc32List) {
            if (newCrc32List.hasOwnProperty(key)) {
                if (!oldCrc32List[key]) {
                    updated.push(key);
                }
            }
        }

        _fireObservers(updated, 'updated');
        _fireObservers(removed, 'deleted');
    }

    /**
     * Fires observers for updated keys
     *
     * @param {Array|String} keys Array of key names or a key
     * @param {String} action What happened with the value (updated, deleted, flushed)
     */
    function _fireObservers(keys, action) {
        keys = [].concat(keys || []);

        var i, j, len, jlen;

        if (action == 'flushed') {
            keys = [];
            for (var key in _observers) {
                if (_observers.hasOwnProperty(key)) {
                    keys.push(key);
                }
            }
            action = 'deleted';
        }
        for (i = 0, len = keys.length; i < len; i++) {
            if (_observers[keys[i]]) {
                for (j = 0, jlen = _observers[keys[i]].length; j < jlen; j++) {
                    _observers[keys[i]][j](keys[i], action);
                }
            }
            if (_observers['*']) {
                for (j = 0, jlen = _observers['*'].length; j < jlen; j++) {
                    _observers['*'][j](keys[i], action);
                }
            }
        }
    }

    /**
     * Publishes key change to listeners
     */
    function _publishChange() {
        var updateTime = (+new Date()).toString();

        if (_backend == 'localStorage' || _backend == 'globalStorage') {
            try {
                _storage_service.jStorage_update = updateTime;
            } catch (E8) {
                // safari private mode has been enabled after the jStorage initialization
                _backend = false;
            }
        } else if (_backend == 'userDataBehavior') {
            _storage_elm.setAttribute('jStorage_update', updateTime);
            _storage_elm.save('jStorage');
        }

        _storageObserver();
    }

    /**
     * Loads the data from the storage based on the supported mechanism
     */
    function _load_storage() {
        /* if jStorage string is retrieved, then decode it */
        if (_storage_service.jStorage) {
            try {
                _storage = JSON.parse(String(_storage_service.jStorage));
            } catch (E6) {
                _storage_service.jStorage = '{}';
            }
        } else {
            _storage_service.jStorage = '{}';
        }
        _storage_size = _storage_service.jStorage ? String(_storage_service.jStorage).length : 0;

        if (!_storage.__jstorage_meta) {
            _storage.__jstorage_meta = {};
        }
        if (!_storage.__jstorage_meta.CRC32) {
            _storage.__jstorage_meta.CRC32 = {};
        }
    }

    /**
     * This functions provides the 'save' mechanism to store the jStorage object
     */
    function _save() {
        _dropOldEvents(); // remove expired events
        try {
            _storage_service.jStorage = JSON.stringify(_storage);
            // If userData is used as the storage engine, additional
            if (_storage_elm) {
                _storage_elm.setAttribute('jStorage', _storage_service.jStorage);
                _storage_elm.save('jStorage');
            }
            _storage_size = _storage_service.jStorage ? String(_storage_service.jStorage).length : 0;
        } catch (E7) { /* probably cache is full, nothing is saved this way*/ }
    }

    /**
     * Function checks if a key is set and is string or numberic
     *
     * @param {String} key Key name
     */
    function _checkKey(key) {
        if (typeof key != 'string' && typeof key != 'number') {
            throw new TypeError('Key name must be string or numeric');
        }
        if (key == '__jstorage_meta') {
            throw new TypeError('Reserved key name');
        }
        return true;
    }

    /**
     * Removes expired keys
     */
    function _handleTTL() {
        var curtime, i, TTL, CRC32, nextExpire = Infinity,
            changed = false,
            deleted = [];

        clearTimeout(_ttl_timeout);

        if (!_storage.__jstorage_meta || typeof _storage.__jstorage_meta.TTL != 'object') {
            // nothing to do here
            return;
        }

        curtime = +new Date();
        TTL = _storage.__jstorage_meta.TTL;

        CRC32 = _storage.__jstorage_meta.CRC32;
        for (i in TTL) {
            if (TTL.hasOwnProperty(i)) {
                if (TTL[i] <= curtime) {
                    delete TTL[i];
                    delete CRC32[i];
                    delete _storage[i];
                    changed = true;
                    deleted.push(i);
                } else if (TTL[i] < nextExpire) {
                    nextExpire = TTL[i];
                }
            }
        }

        // set next check
        if (nextExpire != Infinity) {
            _ttl_timeout = setTimeout(_handleTTL, Math.min(nextExpire - curtime, 0x7FFFFFFF));
        }

        // save changes
        if (changed) {
            _save();
            _publishChange();
            _fireObservers(deleted, 'deleted');
        }
    }

    /**
     * Checks if there's any events on hold to be fired to listeners
     */
    function _handlePubSub() {
        var i, len;
        if (!_storage.__jstorage_meta.PubSub) {
            return;
        }
        var pubelm,
            _pubsubCurrent = _pubsub_last;

        for (i = len = _storage.__jstorage_meta.PubSub.length - 1; i >= 0; i--) {
            pubelm = _storage.__jstorage_meta.PubSub[i];
            if (pubelm[0] > _pubsub_last) {
                _pubsubCurrent = pubelm[0];
                _fireSubscribers(pubelm[1], pubelm[2]);
            }
        }

        _pubsub_last = _pubsubCurrent;
    }

    /**
     * Fires all subscriber listeners for a pubsub channel
     *
     * @param {String} channel Channel name
     * @param {Mixed} payload Payload data to deliver
     */
    function _fireSubscribers(channel, payload) {
        if (_pubsub_observers[channel]) {
            for (var i = 0, len = _pubsub_observers[channel].length; i < len; i++) {
                // send immutable data that can't be modified by listeners
                try {
                    _pubsub_observers[channel][i](channel, JSON.parse(JSON.stringify(payload)));
                } catch (E) {}
            }
        }
    }

    /**
     * Remove old events from the publish stream (at least 2sec old)
     */
    function _dropOldEvents() {
        if (!_storage.__jstorage_meta.PubSub) {
            return;
        }

        var retire = +new Date() - 2000;

        for (var i = 0, len = _storage.__jstorage_meta.PubSub.length; i < len; i++) {
            if (_storage.__jstorage_meta.PubSub[i][0] <= retire) {
                // deleteCount is needed for IE6
                _storage.__jstorage_meta.PubSub.splice(i, _storage.__jstorage_meta.PubSub.length - i);
                break;
            }
        }

        if (!_storage.__jstorage_meta.PubSub.length) {
            delete _storage.__jstorage_meta.PubSub;
        }

    }

    /**
     * Publish payload to a channel
     *
     * @param {String} channel Channel name
     * @param {Mixed} payload Payload to send to the subscribers
     */
    function _publish(channel, payload) {
        if (!_storage.__jstorage_meta) {
            _storage.__jstorage_meta = {};
        }
        if (!_storage.__jstorage_meta.PubSub) {
            _storage.__jstorage_meta.PubSub = [];
        }

        _storage.__jstorage_meta.PubSub.unshift([+new Date(), channel, payload]);

        _save();
        _publishChange();
    }


    /**
     * JS Implementation of MurmurHash2
     *
     *  SOURCE: https://github.com/garycourt/murmurhash-js (MIT licensed)
     *
     * @author <a href='mailto:gary.court@gmail.com'>Gary Court</a>
     * @see http://github.com/garycourt/murmurhash-js
     * @author <a href='mailto:aappleby@gmail.com'>Austin Appleby</a>
     * @see http://sites.google.com/site/murmurhash/
     *
     * @param {string} str ASCII only
     * @param {number} seed Positive integer only
     * @return {number} 32-bit positive integer hash
     */

    function murmurhash2_32_gc(str, seed) {
        var
            l = str.length,
            h = seed ^ l,
            i = 0,
            k;

        while (l >= 4) {
            k =
                ((str.charCodeAt(i) & 0xff)) |
                ((str.charCodeAt(++i) & 0xff) << 8) |
                ((str.charCodeAt(++i) & 0xff) << 16) |
                ((str.charCodeAt(++i) & 0xff) << 24);

            k = (((k & 0xffff) * 0x5bd1e995) + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16));
            k ^= k >>> 24;
            k = (((k & 0xffff) * 0x5bd1e995) + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16));

            h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)) ^ k;

            l -= 4;
            ++i;
        }

        switch (l) {
            case 3:
                h ^= (str.charCodeAt(i + 2) & 0xff) << 16;
            case 2:
                h ^= (str.charCodeAt(i + 1) & 0xff) << 8;
            case 1:
                h ^= (str.charCodeAt(i) & 0xff);
                h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16));
        }

        h ^= h >>> 13;
        h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16));
        h ^= h >>> 15;

        return h >>> 0;
    }

    ////////////////////////// PUBLIC INTERFACE /////////////////////////

    $.jStorage = {
        /* Version number */
        version: JSTORAGE_VERSION,

        /**
         * Sets a key's value.
         *
         * @param {String} key Key to set. If this value is not set or not
         *              a string an exception is raised.
         * @param {Mixed} value Value to set. This can be any value that is JSON
         *              compatible (Numbers, Strings, Objects etc.).
         * @param {Object} [options] - possible options to use
         * @param {Number} [options.TTL] - optional TTL value, in milliseconds
         * @return {Mixed} the used value
         */
        set: function(key, value, options) {
            _checkKey(key);

            options = options || {};

            // undefined values are deleted automatically
            if (typeof value == 'undefined') {
                this.deleteKey(key);
                return value;
            }

            if (_XMLService.isXML(value)) {
                value = {
                    _is_xml: true,
                    xml: _XMLService.encode(value)
                };
            } else if (typeof value == 'function') {
                return undefined; // functions can't be saved!
            } else if (value && typeof value == 'object') {
                // clone the object before saving to _storage tree
                value = JSON.parse(JSON.stringify(value));
            }

            _storage[key] = value;

            _storage.__jstorage_meta.CRC32[key] = '2.' + murmurhash2_32_gc(JSON.stringify(value), 0x9747b28c);

            this.setTTL(key, options.TTL || 0); // also handles saving and _publishChange

            _fireObservers(key, 'updated');
            return value;
        },

        /**
         * Looks up a key in cache
         *
         * @param {String} key - Key to look up.
         * @param {mixed} def - Default value to return, if key didn't exist.
         * @return {Mixed} the key value, default value or null
         */
        get: function(key, def) {
            _checkKey(key);
            if (key in _storage) {
                if (_storage[key] && typeof _storage[key] == 'object' && _storage[key]._is_xml) {
                    return _XMLService.decode(_storage[key].xml);
                } else {
                    return _storage[key];
                }
            }
            return typeof(def) == 'undefined' ? null : def;
        },

        /**
         * Deletes a key from cache.
         *
         * @param {String} key - Key to delete.
         * @return {Boolean} true if key existed or false if it didn't
         */
        deleteKey: function(key) {
            _checkKey(key);
            if (key in _storage) {
                delete _storage[key];
                // remove from TTL list
                if (typeof _storage.__jstorage_meta.TTL == 'object' &&
                    key in _storage.__jstorage_meta.TTL) {
                    delete _storage.__jstorage_meta.TTL[key];
                }

                delete _storage.__jstorage_meta.CRC32[key];

                _save();
                _publishChange();
                _fireObservers(key, 'deleted');
                return true;
            }
            return false;
        },

        /**
         * Sets a TTL for a key, or remove it if ttl value is 0 or below
         *
         * @param {String} key - key to set the TTL for
         * @param {Number} ttl - TTL timeout in milliseconds
         * @return {Boolean} true if key existed or false if it didn't
         */
        setTTL: function(key, ttl) {
            var curtime = +new Date();
            _checkKey(key);
            ttl = Number(ttl) || 0;
            if (key in _storage) {

                if (!_storage.__jstorage_meta.TTL) {
                    _storage.__jstorage_meta.TTL = {};
                }

                // Set TTL value for the key
                if (ttl > 0) {
                    _storage.__jstorage_meta.TTL[key] = curtime + ttl;
                } else {
                    delete _storage.__jstorage_meta.TTL[key];
                }

                _save();

                _handleTTL();

                _publishChange();
                return true;
            }
            return false;
        },

        /**
         * Gets remaining TTL (in milliseconds) for a key or 0 when no TTL has been set
         *
         * @param {String} key Key to check
         * @return {Number} Remaining TTL in milliseconds
         */
        getTTL: function(key) {
            var curtime = +new Date(),
                ttl;
            _checkKey(key);
            if (key in _storage && _storage.__jstorage_meta.TTL && _storage.__jstorage_meta.TTL[key]) {
                ttl = _storage.__jstorage_meta.TTL[key] - curtime;
                return ttl || 0;
            }
            return 0;
        },

        /**
         * Deletes everything in cache.
         *
         * @return {Boolean} Always true
         */
        flush: function() {
            _storage = {
                __jstorage_meta: {
                    CRC32: {}
                }
            };
            _save();
            _publishChange();
            _fireObservers(null, 'flushed');
            return true;
        },

        /**
         * Returns a read-only copy of _storage
         *
         * @return {Object} Read-only copy of _storage
         */
        storageObj: function() {
            function F() {}
            F.prototype = _storage;
            return new F();
        },

        /**
         * Returns an index of all used keys as an array
         * ['key1', 'key2',..'keyN']
         *
         * @return {Array} Used keys
         */
        index: function() {
            var index = [],
                i;
            for (i in _storage) {
                if (_storage.hasOwnProperty(i) && i != '__jstorage_meta') {
                    index.push(i);
                }
            }
            return index;
        },

        /**
         * How much space in bytes does the storage take?
         *
         * @return {Number} Storage size in chars (not the same as in bytes,
         *                  since some chars may take several bytes)
         */
        storageSize: function() {
            return _storage_size;
        },

        /**
         * Which backend is currently in use?
         *
         * @return {String} Backend name
         */
        currentBackend: function() {
            return _backend;
        },

        /**
         * Test if storage is available
         *
         * @return {Boolean} True if storage can be used
         */
        storageAvailable: function() {
            return !!_backend;
        },

        /**
         * Register change listeners
         *
         * @param {String} key Key name
         * @param {Function} callback Function to run when the key changes
         */
        listenKeyChange: function(key, callback) {
            _checkKey(key);
            if (!_observers[key]) {
                _observers[key] = [];
            }
            _observers[key].push(callback);
        },

        /**
         * Remove change listeners
         *
         * @param {String} key Key name to unregister listeners against
         * @param {Function} [callback] If set, unregister the callback, if not - unregister all
         */
        stopListening: function(key, callback) {
            _checkKey(key);

            if (!_observers[key]) {
                return;
            }

            if (!callback) {
                delete _observers[key];
                return;
            }

            for (var i = _observers[key].length - 1; i >= 0; i--) {
                if (_observers[key][i] == callback) {
                    _observers[key].splice(i, 1);
                }
            }
        },

        /**
         * Subscribe to a Publish/Subscribe event stream
         *
         * @param {String} channel Channel name
         * @param {Function} callback Function to run when the something is published to the channel
         */
        subscribe: function(channel, callback) {
            channel = (channel || '').toString();
            if (!channel) {
                throw new TypeError('Channel not defined');
            }
            if (!_pubsub_observers[channel]) {
                _pubsub_observers[channel] = [];
            }
            _pubsub_observers[channel].push(callback);
        },

        /**
         * Publish data to an event stream
         *
         * @param {String} channel Channel name
         * @param {Mixed} payload Payload to deliver
         */
        publish: function(channel, payload) {
            channel = (channel || '').toString();
            if (!channel) {
                throw new TypeError('Channel not defined');
            }

            _publish(channel, payload);
        },

        /**
         * Reloads the data from browser storage
         */
        reInit: function() {
            _reloadData();
        },

        /**
         * Removes reference from global objects and saves it as jStorage
         *
         * @param {Boolean} option if needed to save object as simple 'jStorage' in windows context
         */
        noConflict: function(saveInGlobal) {
            delete window.$.jStorage;

            if (saveInGlobal) {
                window.jStorage = this;
            }

            return this;
        }
    };

    // Initialize jStorage
    _init();

})();
/*!
 * Bootstrap v3.1.1 (http://getbootstrap.com)
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 */

if (typeof jQuery === 'undefined') { throw new Error('Bootstrap\'s JavaScript requires jQuery') }

/* ========================================================================
 * Bootstrap: transition.js v3.1.1
 * http://getbootstrap.com/javascript/#transitions
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // CSS TRANSITION SUPPORT (Shoutout: http://www.modernizr.com/)
  // ============================================================

  function transitionEnd() {
    var el = document.createElement('bootstrap')

    var transEndEventNames = {
      'WebkitTransition' : 'webkitTransitionEnd',
      'MozTransition'    : 'transitionend',
      'OTransition'      : 'oTransitionEnd otransitionend',
      'transition'       : 'transitionend'
    }

    for (var name in transEndEventNames) {
      if (el.style[name] !== undefined) {
        return { end: transEndEventNames[name] }
      }
    }

    return false // explicit for ie8 (  ._.)
  }

  // http://blog.alexmaccaw.com/css-transitions
  $.fn.emulateTransitionEnd = function (duration) {
    var called = false, $el = this
    $(this).one($.support.transition.end, function () { called = true })
    var callback = function () { if (!called) $($el).trigger($.support.transition.end) }
    setTimeout(callback, duration)
    return this
  }

  $(function () {
    $.support.transition = transitionEnd()
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: alert.js v3.1.1
 * http://getbootstrap.com/javascript/#alerts
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // ALERT CLASS DEFINITION
  // ======================

  var dismiss = '[data-dismiss="alert"]'
  var Alert   = function (el) {
    $(el).on('click', dismiss, this.close)
  }

  Alert.prototype.close = function (e) {
    var $this    = $(this)
    var selector = $this.attr('data-target')

    if (!selector) {
      selector = $this.attr('href')
      selector = selector && selector.replace(/.*(?=#[^\s]*$)/, '') // strip for ie7
    }

    var $parent = $(selector)

    if (e) e.preventDefault()

    if (!$parent.length) {
      $parent = $this.hasClass('alert') ? $this : $this.parent()
    }

    $parent.trigger(e = $.Event('close.bs.alert'))

    if (e.isDefaultPrevented()) return

    $parent.removeClass('in')

    function removeElement() {
      $parent.trigger('closed.bs.alert').remove()
    }

    $.support.transition && $parent.hasClass('fade') ?
      $parent
        .one($.support.transition.end, removeElement)
        .emulateTransitionEnd(150) :
      removeElement()
  }


  // ALERT PLUGIN DEFINITION
  // =======================

  var old = $.fn.alert

  $.fn.alert = function (option) {
    return this.each(function () {
      var $this = $(this)
      var data  = $this.data('bs.alert')

      if (!data) $this.data('bs.alert', (data = new Alert(this)))
      if (typeof option == 'string') data[option].call($this)
    })
  }

  $.fn.alert.Constructor = Alert


  // ALERT NO CONFLICT
  // =================

  $.fn.alert.noConflict = function () {
    $.fn.alert = old
    return this
  }


  // ALERT DATA-API
  // ==============

  $(document).on('click.bs.alert.data-api', dismiss, Alert.prototype.close)

}(jQuery);

/* ========================================================================
 * Bootstrap: button.js v3.1.1
 * http://getbootstrap.com/javascript/#buttons
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // BUTTON PUBLIC CLASS DEFINITION
  // ==============================

  var Button = function (element, options) {
    this.$element  = $(element)
    this.options   = $.extend({}, Button.DEFAULTS, options)
    this.isLoading = false
  }

  Button.DEFAULTS = {
    loadingText: 'loading...'
  }

  Button.prototype.setState = function (state) {
    var d    = 'disabled'
    var $el  = this.$element
    var val  = $el.is('input') ? 'val' : 'html'
    var data = $el.data()

    state = state + 'Text'

    if (!data.resetText) $el.data('resetText', $el[val]())

    $el[val](data[state] || this.options[state])

    // push to event loop to allow forms to submit
    setTimeout($.proxy(function () {
      if (state == 'loadingText') {
        this.isLoading = true
        $el.addClass(d).attr(d, d)
      } else if (this.isLoading) {
        this.isLoading = false
        $el.removeClass(d).removeAttr(d)
      }
    }, this), 0)
  }

  Button.prototype.toggle = function () {
    var changed = true
    var $parent = this.$element.closest('[data-toggle="buttons"]')

    if ($parent.length) {
      var $input = this.$element.find('input')
      if ($input.prop('type') == 'radio') {
        if ($input.prop('checked') && this.$element.hasClass('active')) changed = false
        else $parent.find('.active').removeClass('active')
      }
      if (changed) $input.prop('checked', !this.$element.hasClass('active')).trigger('change')
    }

    if (changed) this.$element.toggleClass('active')
  }


  // BUTTON PLUGIN DEFINITION
  // ========================

  var old = $.fn.button

  $.fn.button = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.button')
      var options = typeof option == 'object' && option

      if (!data) $this.data('bs.button', (data = new Button(this, options)))

      if (option == 'toggle') data.toggle()
      else if (option) data.setState(option)
    })
  }

  $.fn.button.Constructor = Button


  // BUTTON NO CONFLICT
  // ==================

  $.fn.button.noConflict = function () {
    $.fn.button = old
    return this
  }


  // BUTTON DATA-API
  // ===============

  $(document).on('click.bs.button.data-api', '[data-toggle^=button]', function (e) {
    var $btn = $(e.target)
    if (!$btn.hasClass('btn')) $btn = $btn.closest('.btn')
    $btn.button('toggle')
    e.preventDefault()
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: carousel.js v3.1.1
 * http://getbootstrap.com/javascript/#carousel
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // CAROUSEL CLASS DEFINITION
  // =========================

  var Carousel = function (element, options) {
    this.$element    = $(element)
    this.$indicators = this.$element.find('.carousel-indicators')
    this.options     = options
    this.paused      =
    this.sliding     =
    this.interval    =
    this.$active     =
    this.$items      = null

    this.options.pause == 'hover' && this.$element
      .on('mouseenter', $.proxy(this.pause, this))
      .on('mouseleave', $.proxy(this.cycle, this))
  }

  Carousel.DEFAULTS = {
    interval: 5000,
    pause: 'hover',
    wrap: true
  }

  Carousel.prototype.cycle =  function (e) {
    e || (this.paused = false)

    this.interval && clearInterval(this.interval)

    this.options.interval
      && !this.paused
      && (this.interval = setInterval($.proxy(this.next, this), this.options.interval))

    return this
  }

  Carousel.prototype.getActiveIndex = function () {
    this.$active = this.$element.find('.item.active')
    this.$items  = this.$active.parent().children()

    return this.$items.index(this.$active)
  }

  Carousel.prototype.to = function (pos) {
    var that        = this
    var activeIndex = this.getActiveIndex()

    if (pos > (this.$items.length - 1) || pos < 0) return

    if (this.sliding)       return this.$element.one('slid.bs.carousel', function () { that.to(pos) })
    if (activeIndex == pos) return this.pause().cycle()

    return this.slide(pos > activeIndex ? 'next' : 'prev', $(this.$items[pos]))
  }

  Carousel.prototype.pause = function (e) {
    e || (this.paused = true)

    if (this.$element.find('.next, .prev').length && $.support.transition) {
      this.$element.trigger($.support.transition.end)
      this.cycle(true)
    }

    this.interval = clearInterval(this.interval)

    return this
  }

  Carousel.prototype.next = function () {
    if (this.sliding) return
    return this.slide('next')
  }

  Carousel.prototype.prev = function () {
    if (this.sliding) return
    return this.slide('prev')
  }

  Carousel.prototype.slide = function (type, next) {
    var $active   = this.$element.find('.item.active')
    var $next     = next || $active[type]()
    var isCycling = this.interval
    var direction = type == 'next' ? 'left' : 'right'
    var fallback  = type == 'next' ? 'first' : 'last'
    var that      = this

    if (!$next.length) {
      if (!this.options.wrap) return
      $next = this.$element.find('.item')[fallback]()
    }

    if ($next.hasClass('active')) return this.sliding = false

    var e = $.Event('slide.bs.carousel', { relatedTarget: $next[0], direction: direction })
    this.$element.trigger(e)
    if (e.isDefaultPrevented()) return

    this.sliding = true

    isCycling && this.pause()

    if (this.$indicators.length) {
      this.$indicators.find('.active').removeClass('active')
      this.$element.one('slid.bs.carousel', function () {
        var $nextIndicator = $(that.$indicators.children()[that.getActiveIndex()])
        $nextIndicator && $nextIndicator.addClass('active')
      })
    }

    if ($.support.transition && this.$element.hasClass('slide')) {
      $next.addClass(type)
      $next[0].offsetWidth // force reflow
      $active.addClass(direction)
      $next.addClass(direction)
      $active
        .one($.support.transition.end, function () {
          $next.removeClass([type, direction].join(' ')).addClass('active')
          $active.removeClass(['active', direction].join(' '))
          that.sliding = false
          setTimeout(function () { that.$element.trigger('slid.bs.carousel') }, 0)
        })
        .emulateTransitionEnd($active.css('transition-duration').slice(0, -1) * 1000)
    } else {
      $active.removeClass('active')
      $next.addClass('active')
      this.sliding = false
      this.$element.trigger('slid.bs.carousel')
    }

    isCycling && this.cycle()

    return this
  }


  // CAROUSEL PLUGIN DEFINITION
  // ==========================

  var old = $.fn.carousel

  $.fn.carousel = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.carousel')
      var options = $.extend({}, Carousel.DEFAULTS, $this.data(), typeof option == 'object' && option)
      var action  = typeof option == 'string' ? option : options.slide

      if (!data) $this.data('bs.carousel', (data = new Carousel(this, options)))
      if (typeof option == 'number') data.to(option)
      else if (action) data[action]()
      else if (options.interval) data.pause().cycle()
    })
  }

  $.fn.carousel.Constructor = Carousel


  // CAROUSEL NO CONFLICT
  // ====================

  $.fn.carousel.noConflict = function () {
    $.fn.carousel = old
    return this
  }


  // CAROUSEL DATA-API
  // =================

  $(document).on('click.bs.carousel.data-api', '[data-slide], [data-slide-to]', function (e) {
    var $this   = $(this), href
    var $target = $($this.attr('data-target') || (href = $this.attr('href')) && href.replace(/.*(?=#[^\s]+$)/, '')) //strip for ie7
    var options = $.extend({}, $target.data(), $this.data())
    var slideIndex = $this.attr('data-slide-to')
    if (slideIndex) options.interval = false

    $target.carousel(options)

    if (slideIndex = $this.attr('data-slide-to')) {
      $target.data('bs.carousel').to(slideIndex)
    }

    e.preventDefault()
  })

  $(window).on('load', function () {
    $('[data-ride="carousel"]').each(function () {
      var $carousel = $(this)
      $carousel.carousel($carousel.data())
    })
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: collapse.js v3.1.1
 * http://getbootstrap.com/javascript/#collapse
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // COLLAPSE PUBLIC CLASS DEFINITION
  // ================================

  var Collapse = function (element, options) {
    this.$element      = $(element)
    this.options       = $.extend({}, Collapse.DEFAULTS, options)
    this.transitioning = null

    if (this.options.parent) this.$parent = $(this.options.parent)
    if (this.options.toggle) this.toggle()
  }

  Collapse.DEFAULTS = {
    toggle: true
  }

  Collapse.prototype.dimension = function () {
    var hasWidth = this.$element.hasClass('width')
    return hasWidth ? 'width' : 'height'
  }

  Collapse.prototype.show = function () {
    if (this.transitioning || this.$element.hasClass('in')) return

    var startEvent = $.Event('show.bs.collapse')
    this.$element.trigger(startEvent)
    if (startEvent.isDefaultPrevented()) return

    var actives = this.$parent && this.$parent.find('> .panel > .in')

    if (actives && actives.length) {
      var hasData = actives.data('bs.collapse')
      if (hasData && hasData.transitioning) return
      actives.collapse('hide')
      hasData || actives.data('bs.collapse', null)
    }

    var dimension = this.dimension()

    this.$element
      .removeClass('collapse')
      .addClass('collapsing')
      [dimension](0)

    this.transitioning = 1

    var complete = function () {
      this.$element
        .removeClass('collapsing')
        .addClass('collapse in')
        [dimension]('auto')
      this.transitioning = 0
      this.$element.trigger('shown.bs.collapse')
    }

    if (!$.support.transition) return complete.call(this)

    var scrollSize = $.camelCase(['scroll', dimension].join('-'))

    this.$element
      .one($.support.transition.end, $.proxy(complete, this))
      .emulateTransitionEnd(350)
      [dimension](this.$element[0][scrollSize])
  }

  Collapse.prototype.hide = function () {
    if (this.transitioning || !this.$element.hasClass('in')) return

    var startEvent = $.Event('hide.bs.collapse')
    this.$element.trigger(startEvent)
    if (startEvent.isDefaultPrevented()) return

    var dimension = this.dimension()

    this.$element
      [dimension](this.$element[dimension]())
      [0].offsetHeight

    this.$element
      .addClass('collapsing')
      .removeClass('collapse')
      .removeClass('in')

    this.transitioning = 1

    var complete = function () {
      this.transitioning = 0
      this.$element
        .trigger('hidden.bs.collapse')
        .removeClass('collapsing')
        .addClass('collapse')
    }

    if (!$.support.transition) return complete.call(this)

    this.$element
      [dimension](0)
      .one($.support.transition.end, $.proxy(complete, this))
      .emulateTransitionEnd(350)
  }

  Collapse.prototype.toggle = function () {
    this[this.$element.hasClass('in') ? 'hide' : 'show']()
  }


  // COLLAPSE PLUGIN DEFINITION
  // ==========================

  var old = $.fn.collapse

  $.fn.collapse = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.collapse')
      var options = $.extend({}, Collapse.DEFAULTS, $this.data(), typeof option == 'object' && option)

      if (!data && options.toggle && option == 'show') option = !option
      if (!data) $this.data('bs.collapse', (data = new Collapse(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.collapse.Constructor = Collapse


  // COLLAPSE NO CONFLICT
  // ====================

  $.fn.collapse.noConflict = function () {
    $.fn.collapse = old
    return this
  }


  // COLLAPSE DATA-API
  // =================

  $(document).on('click.bs.collapse.data-api', '[data-toggle=collapse]', function (e) {
    var $this   = $(this), href
    var target  = $this.attr('data-target')
        || e.preventDefault()
        || (href = $this.attr('href')) && href.replace(/.*(?=#[^\s]+$)/, '') //strip for ie7
    var $target = $(target)
    var data    = $target.data('bs.collapse')
    var option  = data ? 'toggle' : $this.data()
    var parent  = $this.attr('data-parent')
    var $parent = parent && $(parent)

    if (!data || !data.transitioning) {
      if ($parent) $parent.find('[data-toggle=collapse][data-parent="' + parent + '"]').not($this).addClass('collapsed')
      $this[$target.hasClass('in') ? 'addClass' : 'removeClass']('collapsed')
    }

    $target.collapse(option)
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: dropdown.js v3.1.1
 * http://getbootstrap.com/javascript/#dropdowns
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // DROPDOWN CLASS DEFINITION
  // =========================

  var backdrop = '.dropdown-backdrop'
  var toggle   = '[data-toggle=dropdown]'
  var Dropdown = function (element) {
    $(element).on('click.bs.dropdown', this.toggle)
  }

  Dropdown.prototype.toggle = function (e) {
    var $this = $(this)

    if ($this.is('.disabled, :disabled')) return

    var $parent  = getParent($this)
    var isActive = $parent.hasClass('open')

    clearMenus()

    if (!isActive) {
      if ('ontouchstart' in document.documentElement && !$parent.closest('.navbar-nav').length) {
        // if mobile we use a backdrop because click events don't delegate
        $('<div class="dropdown-backdrop"/>').insertAfter($(this)).on('click', clearMenus)
      }

      var relatedTarget = { relatedTarget: this }
      $parent.trigger(e = $.Event('show.bs.dropdown', relatedTarget))

      if (e.isDefaultPrevented()) return

      $parent
        .toggleClass('open')
        .trigger('shown.bs.dropdown', relatedTarget)

      $this.focus()
    }

    return false
  }

  Dropdown.prototype.keydown = function (e) {
    if (!/(38|40|27)/.test(e.keyCode)) return

    var $this = $(this)

    e.preventDefault()
    e.stopPropagation()

    if ($this.is('.disabled, :disabled')) return

    var $parent  = getParent($this)
    var isActive = $parent.hasClass('open')

    if (!isActive || (isActive && e.keyCode == 27)) {
      if (e.which == 27) $parent.find(toggle).focus()
      return $this.click()
    }

    var desc = ' li:not(.divider):visible a'
    var $items = $parent.find('[role=menu]' + desc + ', [role=listbox]' + desc)

    if (!$items.length) return

    var index = $items.index($items.filter(':focus'))

    if (e.keyCode == 38 && index > 0)                 index--                        // up
    if (e.keyCode == 40 && index < $items.length - 1) index++                        // down
    if (!~index)                                      index = 0

    $items.eq(index).focus()
  }

  function clearMenus(e) {
    $(backdrop).remove()
    $(toggle).each(function () {
      var $parent = getParent($(this))
      var relatedTarget = { relatedTarget: this }
      if (!$parent.hasClass('open')) return
      $parent.trigger(e = $.Event('hide.bs.dropdown', relatedTarget))
      if (e.isDefaultPrevented()) return
      $parent.removeClass('open').trigger('hidden.bs.dropdown', relatedTarget)
    })
  }

  function getParent($this) {
    var selector = $this.attr('data-target')

    if (!selector) {
      selector = $this.attr('href')
      selector = selector && /#[A-Za-z]/.test(selector) && selector.replace(/.*(?=#[^\s]*$)/, '') //strip for ie7
    }

    var $parent = selector && $(selector)

    return $parent && $parent.length ? $parent : $this.parent()
  }


  // DROPDOWN PLUGIN DEFINITION
  // ==========================

  var old = $.fn.dropdown

  $.fn.dropdown = function (option) {
    return this.each(function () {
      var $this = $(this)
      var data  = $this.data('bs.dropdown')

      if (!data) $this.data('bs.dropdown', (data = new Dropdown(this)))
      if (typeof option == 'string') data[option].call($this)
    })
  }

  $.fn.dropdown.Constructor = Dropdown


  // DROPDOWN NO CONFLICT
  // ====================

  $.fn.dropdown.noConflict = function () {
    $.fn.dropdown = old
    return this
  }


  // APPLY TO STANDARD DROPDOWN ELEMENTS
  // ===================================

  $(document)
    .on('click.bs.dropdown.data-api', clearMenus)
    .on('click.bs.dropdown.data-api', '.dropdown form', function (e) { e.stopPropagation() })
    .on('click.bs.dropdown.data-api', toggle, Dropdown.prototype.toggle)
    .on('keydown.bs.dropdown.data-api', toggle + ', [role=menu], [role=listbox]', Dropdown.prototype.keydown)

}(jQuery);

/* ========================================================================
 * Bootstrap: modal.js v3.1.1
 * http://getbootstrap.com/javascript/#modals
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // MODAL CLASS DEFINITION
  // ======================

  var Modal = function (element, options) {
    this.options   = options
    this.$element  = $(element)
    this.$backdrop =
    this.isShown   = null

    if (this.options.remote) {
      this.$element
        .find('.modal-content')
        .load(this.options.remote, $.proxy(function () {
          this.$element.trigger('loaded.bs.modal')
        }, this))
    }
  }

  Modal.DEFAULTS = {
    backdrop: true,
    keyboard: true,
    show: true
  }

  Modal.prototype.toggle = function (_relatedTarget) {
    return this[!this.isShown ? 'show' : 'hide'](_relatedTarget)
  }

  Modal.prototype.show = function (_relatedTarget) {
    var that = this
    var e    = $.Event('show.bs.modal', { relatedTarget: _relatedTarget })

    this.$element.trigger(e)

    if (this.isShown || e.isDefaultPrevented()) return

    this.isShown = true

    this.escape()

    this.$element.on('click.dismiss.bs.modal', '[data-dismiss="modal"]', $.proxy(this.hide, this))

    this.backdrop(function () {
      var transition = $.support.transition && that.$element.hasClass('fade')

      if (!that.$element.parent().length) {
        that.$element.appendTo(document.body) // don't move modals dom position
      }

      that.$element
        .show()
        .scrollTop(0)

      if (transition) {
        that.$element[0].offsetWidth // force reflow
      }

      that.$element
        .addClass('in')
        .attr('aria-hidden', false)

      that.enforceFocus()

      var e = $.Event('shown.bs.modal', { relatedTarget: _relatedTarget })

      transition ?
        that.$element.find('.modal-dialog') // wait for modal to slide in
          .one($.support.transition.end, function () {
            that.$element.focus().trigger(e)
          })
          .emulateTransitionEnd(300) :
        that.$element.focus().trigger(e)
    })
  }

  Modal.prototype.hide = function (e) {
    if (e) e.preventDefault()

    e = $.Event('hide.bs.modal')

    this.$element.trigger(e)

    if (!this.isShown || e.isDefaultPrevented()) return

    this.isShown = false

    this.escape()

    $(document).off('focusin.bs.modal')

    this.$element
      .removeClass('in')
      .attr('aria-hidden', true)
      .off('click.dismiss.bs.modal')

    $.support.transition && this.$element.hasClass('fade') ?
      this.$element
        .one($.support.transition.end, $.proxy(this.hideModal, this))
        .emulateTransitionEnd(300) :
      this.hideModal()
  }

  Modal.prototype.enforceFocus = function () {
    $(document)
      .off('focusin.bs.modal') // guard against infinite focus loop
      .on('focusin.bs.modal', $.proxy(function (e) {
        if (this.$element[0] !== e.target && !this.$element.has(e.target).length) {
          this.$element.focus()
        }
      }, this))
  }

  Modal.prototype.escape = function () {
    if (this.isShown && this.options.keyboard) {
      this.$element.on('keyup.dismiss.bs.modal', $.proxy(function (e) {
        e.which == 27 && this.hide()
      }, this))
    } else if (!this.isShown) {
      this.$element.off('keyup.dismiss.bs.modal')
    }
  }

  Modal.prototype.hideModal = function () {
    var that = this
    this.$element.hide()
    this.backdrop(function () {
      that.removeBackdrop()
      that.$element.trigger('hidden.bs.modal')
    })
  }

  Modal.prototype.removeBackdrop = function () {
    this.$backdrop && this.$backdrop.remove()
    this.$backdrop = null
  }

  Modal.prototype.backdrop = function (callback) {
    var animate = this.$element.hasClass('fade') ? 'fade' : ''

    if (this.isShown && this.options.backdrop) {
      var doAnimate = $.support.transition && animate

      this.$backdrop = $('<div class="modal-backdrop ' + animate + '" />')
        .appendTo(document.body)

      this.$element.on('click.dismiss.bs.modal', $.proxy(function (e) {
        if (e.target !== e.currentTarget) return
        this.options.backdrop == 'static'
          ? this.$element[0].focus.call(this.$element[0])
          : this.hide.call(this)
      }, this))

      if (doAnimate) this.$backdrop[0].offsetWidth // force reflow

      this.$backdrop.addClass('in')

      if (!callback) return

      doAnimate ?
        this.$backdrop
          .one($.support.transition.end, callback)
          .emulateTransitionEnd(150) :
        callback()

    } else if (!this.isShown && this.$backdrop) {
      this.$backdrop.removeClass('in')

      $.support.transition && this.$element.hasClass('fade') ?
        this.$backdrop
          .one($.support.transition.end, callback)
          .emulateTransitionEnd(150) :
        callback()

    } else if (callback) {
      callback()
    }
  }


  // MODAL PLUGIN DEFINITION
  // =======================

  var old = $.fn.modal

  $.fn.modal = function (option, _relatedTarget) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.modal')
      var options = $.extend({}, Modal.DEFAULTS, $this.data(), typeof option == 'object' && option)

      if (!data) $this.data('bs.modal', (data = new Modal(this, options)))
      if (typeof option == 'string') data[option](_relatedTarget)
      else if (options.show) data.show(_relatedTarget)
    })
  }

  $.fn.modal.Constructor = Modal


  // MODAL NO CONFLICT
  // =================

  $.fn.modal.noConflict = function () {
    $.fn.modal = old
    return this
  }


  // MODAL DATA-API
  // ==============

  $(document).on('click.bs.modal.data-api', '[data-toggle="modal"]', function (e) {
    var $this   = $(this)
    var href    = $this.attr('href')
    var $target = $($this.attr('data-target') || (href && href.replace(/.*(?=#[^\s]+$)/, ''))) //strip for ie7
    var option  = $target.data('bs.modal') ? 'toggle' : $.extend({ remote: !/#/.test(href) && href }, $target.data(), $this.data())

    if ($this.is('a')) e.preventDefault()

    $target
      .modal(option, this)
      .one('hide', function () {
        $this.is(':visible') && $this.focus()
      })
  })

  $(document)
    .on('show.bs.modal', '.modal', function () { $(document.body).addClass('modal-open') })
    .on('hidden.bs.modal', '.modal', function () { $(document.body).removeClass('modal-open') })

}(jQuery);

/* ========================================================================
 * Bootstrap: tooltip.js v3.1.1
 * http://getbootstrap.com/javascript/#tooltip
 * Inspired by the original jQuery.tipsy by Jason Frame
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // TOOLTIP PUBLIC CLASS DEFINITION
  // ===============================

  var Tooltip = function (element, options) {
    this.type       =
    this.options    =
    this.enabled    =
    this.timeout    =
    this.hoverState =
    this.$element   = null

    this.init('tooltip', element, options)
  }

  Tooltip.DEFAULTS = {
    animation: true,
    placement: 'top',
    selector: false,
    template: '<div class="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>',
    trigger: 'hover focus',
    title: '',
    delay: 0,
    html: false,
    container: false
  }

  Tooltip.prototype.init = function (type, element, options) {
    this.enabled  = true
    this.type     = type
    this.$element = $(element)
    this.options  = this.getOptions(options)

    var triggers = this.options.trigger.split(' ')

    for (var i = triggers.length; i--;) {
      var trigger = triggers[i]

      if (trigger == 'click') {
        this.$element.on('click.' + this.type, this.options.selector, $.proxy(this.toggle, this))
      } else if (trigger != 'manual') {
        var eventIn  = trigger == 'hover' ? 'mouseenter' : 'focusin'
        var eventOut = trigger == 'hover' ? 'mouseleave' : 'focusout'

        this.$element.on(eventIn  + '.' + this.type, this.options.selector, $.proxy(this.enter, this))
        this.$element.on(eventOut + '.' + this.type, this.options.selector, $.proxy(this.leave, this))
      }
    }

    this.options.selector ?
      (this._options = $.extend({}, this.options, { trigger: 'manual', selector: '' })) :
      this.fixTitle()
  }

  Tooltip.prototype.getDefaults = function () {
    return Tooltip.DEFAULTS
  }

  Tooltip.prototype.getOptions = function (options) {
    options = $.extend({}, this.getDefaults(), this.$element.data(), options)

    if (options.delay && typeof options.delay == 'number') {
      options.delay = {
        show: options.delay,
        hide: options.delay
      }
    }

    return options
  }

  Tooltip.prototype.getDelegateOptions = function () {
    var options  = {}
    var defaults = this.getDefaults()

    this._options && $.each(this._options, function (key, value) {
      if (defaults[key] != value) options[key] = value
    })

    return options
  }

  Tooltip.prototype.enter = function (obj) {
    var self = obj instanceof this.constructor ?
      obj : $(obj.currentTarget)[this.type](this.getDelegateOptions()).data('bs.' + this.type)

    clearTimeout(self.timeout)

    self.hoverState = 'in'

    if (!self.options.delay || !self.options.delay.show) return self.show()

    self.timeout = setTimeout(function () {
      if (self.hoverState == 'in') self.show()
    }, self.options.delay.show)
  }

  Tooltip.prototype.leave = function (obj) {
    var self = obj instanceof this.constructor ?
      obj : $(obj.currentTarget)[this.type](this.getDelegateOptions()).data('bs.' + this.type)

    clearTimeout(self.timeout)

    self.hoverState = 'out'

    if (!self.options.delay || !self.options.delay.hide) return self.hide()

    self.timeout = setTimeout(function () {
      if (self.hoverState == 'out') self.hide()
    }, self.options.delay.hide)
  }

  Tooltip.prototype.show = function () {
    var e = $.Event('show.bs.' + this.type)

    if (this.hasContent() && this.enabled) {
      this.$element.trigger(e)

      if (e.isDefaultPrevented()) return
      var that = this;

      var $tip = this.tip()

      this.setContent()

      if (this.options.animation) $tip.addClass('fade')

      var placement = typeof this.options.placement == 'function' ?
        this.options.placement.call(this, $tip[0], this.$element[0]) :
        this.options.placement

      var autoToken = /\s?auto?\s?/i
      var autoPlace = autoToken.test(placement)
      if (autoPlace) placement = placement.replace(autoToken, '') || 'top'

      $tip
        .detach()
        .css({ top: 0, left: 0, display: 'block' })
        .addClass(placement)

      this.options.container ? $tip.appendTo(this.options.container) : $tip.insertAfter(this.$element)

      var pos          = this.getPosition()
      var actualWidth  = $tip[0].offsetWidth
      var actualHeight = $tip[0].offsetHeight

      if (autoPlace) {
        var $parent = this.$element.parent()

        var orgPlacement = placement
        var docScroll    = document.documentElement.scrollTop || document.body.scrollTop
        var parentWidth  = this.options.container == 'body' ? window.innerWidth  : $parent.outerWidth()
        var parentHeight = this.options.container == 'body' ? window.innerHeight : $parent.outerHeight()
        var parentLeft   = this.options.container == 'body' ? 0 : $parent.offset().left

        placement = placement == 'bottom' && pos.top   + pos.height  + actualHeight - docScroll > parentHeight  ? 'top'    :
                    placement == 'top'    && pos.top   - docScroll   - actualHeight < 0                         ? 'bottom' :
                    placement == 'right'  && pos.right + actualWidth > parentWidth                              ? 'left'   :
                    placement == 'left'   && pos.left  - actualWidth < parentLeft                               ? 'right'  :
                    placement

        $tip
          .removeClass(orgPlacement)
          .addClass(placement)
      }

      var calculatedOffset = this.getCalculatedOffset(placement, pos, actualWidth, actualHeight)

      this.applyPlacement(calculatedOffset, placement)
      this.hoverState = null

      var complete = function() {
        that.$element.trigger('shown.bs.' + that.type)
      }

      $.support.transition && this.$tip.hasClass('fade') ?
        $tip
          .one($.support.transition.end, complete)
          .emulateTransitionEnd(150) :
        complete()
    }
  }

  Tooltip.prototype.applyPlacement = function (offset, placement) {
    var replace
    var $tip   = this.tip()
    var width  = $tip[0].offsetWidth
    var height = $tip[0].offsetHeight

    // manually read margins because getBoundingClientRect includes difference
    var marginTop = parseInt($tip.css('margin-top'), 10)
    var marginLeft = parseInt($tip.css('margin-left'), 10)

    // we must check for NaN for ie 8/9
    if (isNaN(marginTop))  marginTop  = 0
    if (isNaN(marginLeft)) marginLeft = 0

    offset.top  = offset.top  + marginTop
    offset.left = offset.left + marginLeft

    // $.fn.offset doesn't round pixel values
    // so we use setOffset directly with our own function B-0
    $.offset.setOffset($tip[0], $.extend({
      using: function (props) {
        $tip.css({
          top: Math.round(props.top),
          left: Math.round(props.left)
        })
      }
    }, offset), 0)

    $tip.addClass('in')

    // check to see if placing tip in new offset caused the tip to resize itself
    var actualWidth  = $tip[0].offsetWidth
    var actualHeight = $tip[0].offsetHeight

    if (placement == 'top' && actualHeight != height) {
      replace = true
      offset.top = offset.top + height - actualHeight
    }

    if (/bottom|top/.test(placement)) {
      var delta = 0

      if (offset.left < 0) {
        delta       = offset.left * -2
        offset.left = 0

        $tip.offset(offset)

        actualWidth  = $tip[0].offsetWidth
        actualHeight = $tip[0].offsetHeight
      }

      this.replaceArrow(delta - width + actualWidth, actualWidth, 'left')
    } else {
      this.replaceArrow(actualHeight - height, actualHeight, 'top')
    }

    if (replace) $tip.offset(offset)
  }

  Tooltip.prototype.replaceArrow = function (delta, dimension, position) {
    this.arrow().css(position, delta ? (50 * (1 - delta / dimension) + '%') : '')
  }

  Tooltip.prototype.setContent = function () {
    var $tip  = this.tip()
    var title = this.getTitle()

    $tip.find('.tooltip-inner')[this.options.html ? 'html' : 'text'](title)
    $tip.removeClass('fade in top bottom left right')
  }

  Tooltip.prototype.hide = function () {
    var that = this
    var $tip = this.tip()
    var e    = $.Event('hide.bs.' + this.type)

    function complete() {
      if (that.hoverState != 'in') $tip.detach()
      that.$element.trigger('hidden.bs.' + that.type)
    }

    this.$element.trigger(e)

    if (e.isDefaultPrevented()) return

    $tip.removeClass('in')

    $.support.transition && this.$tip.hasClass('fade') ?
      $tip
        .one($.support.transition.end, complete)
        .emulateTransitionEnd(150) :
      complete()

    this.hoverState = null

    return this
  }

  Tooltip.prototype.fixTitle = function () {
    var $e = this.$element
    if ($e.attr('title') || typeof($e.attr('data-original-title')) != 'string') {
      $e.attr('data-original-title', $e.attr('title') || '').attr('title', '')
    }
  }

  Tooltip.prototype.hasContent = function () {
    return this.getTitle()
  }

  Tooltip.prototype.getPosition = function () {
    var el = this.$element[0]
    return $.extend({}, (typeof el.getBoundingClientRect == 'function') ? el.getBoundingClientRect() : {
      width: el.offsetWidth,
      height: el.offsetHeight
    }, this.$element.offset())
  }

  Tooltip.prototype.getCalculatedOffset = function (placement, pos, actualWidth, actualHeight) {
    return placement == 'bottom' ? { top: pos.top + pos.height,   left: pos.left + pos.width / 2 - actualWidth / 2  } :
           placement == 'top'    ? { top: pos.top - actualHeight, left: pos.left + pos.width / 2 - actualWidth / 2  } :
           placement == 'left'   ? { top: pos.top + pos.height / 2 - actualHeight / 2, left: pos.left - actualWidth } :
        /* placement == 'right' */ { top: pos.top + pos.height / 2 - actualHeight / 2, left: pos.left + pos.width   }
  }

  Tooltip.prototype.getTitle = function () {
    var title
    var $e = this.$element
    var o  = this.options

    title = $e.attr('data-original-title')
      || (typeof o.title == 'function' ? o.title.call($e[0]) :  o.title)

    return title
  }

  Tooltip.prototype.tip = function () {
    return this.$tip = this.$tip || $(this.options.template)
  }

  Tooltip.prototype.arrow = function () {
    return this.$arrow = this.$arrow || this.tip().find('.tooltip-arrow')
  }

  Tooltip.prototype.validate = function () {
    if (!this.$element[0].parentNode) {
      this.hide()
      this.$element = null
      this.options  = null
    }
  }

  Tooltip.prototype.enable = function () {
    this.enabled = true
  }

  Tooltip.prototype.disable = function () {
    this.enabled = false
  }

  Tooltip.prototype.toggleEnabled = function () {
    this.enabled = !this.enabled
  }

  Tooltip.prototype.toggle = function (e) {
    var self = e ? $(e.currentTarget)[this.type](this.getDelegateOptions()).data('bs.' + this.type) : this
    self.tip().hasClass('in') ? self.leave(self) : self.enter(self)
  }

  Tooltip.prototype.destroy = function () {
    clearTimeout(this.timeout)
    this.hide().$element.off('.' + this.type).removeData('bs.' + this.type)
  }


  // TOOLTIP PLUGIN DEFINITION
  // =========================

  var old = $.fn.tooltip

  $.fn.tooltip = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.tooltip')
      var options = typeof option == 'object' && option

      if (!data && option == 'destroy') return
      if (!data) $this.data('bs.tooltip', (data = new Tooltip(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.tooltip.Constructor = Tooltip


  // TOOLTIP NO CONFLICT
  // ===================

  $.fn.tooltip.noConflict = function () {
    $.fn.tooltip = old
    return this
  }

}(jQuery);

/* ========================================================================
 * Bootstrap: popover.js v3.1.1
 * http://getbootstrap.com/javascript/#popovers
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // POPOVER PUBLIC CLASS DEFINITION
  // ===============================

  var Popover = function (element, options) {
    this.init('popover', element, options)
  }

  if (!$.fn.tooltip) throw new Error('Popover requires tooltip.js')

  Popover.DEFAULTS = $.extend({}, $.fn.tooltip.Constructor.DEFAULTS, {
    placement: 'right',
    trigger: 'click',
    content: '',
    template: '<div class="popover"><div class="arrow"></div><h3 class="popover-title"></h3><div class="popover-content"></div></div>'
  })


  // NOTE: POPOVER EXTENDS tooltip.js
  // ================================

  Popover.prototype = $.extend({}, $.fn.tooltip.Constructor.prototype)

  Popover.prototype.constructor = Popover

  Popover.prototype.getDefaults = function () {
    return Popover.DEFAULTS
  }

  Popover.prototype.setContent = function () {
    var $tip    = this.tip()
    var title   = this.getTitle()
    var content = this.getContent()

    $tip.find('.popover-title')[this.options.html ? 'html' : 'text'](title)
    $tip.find('.popover-content')[ // we use append for html objects to maintain js events
      this.options.html ? (typeof content == 'string' ? 'html' : 'append') : 'text'
    ](content)

    $tip.removeClass('fade top bottom left right in')

    // IE8 doesn't accept hiding via the `:empty` pseudo selector, we have to do
    // this manually by checking the contents.
    if (!$tip.find('.popover-title').html()) $tip.find('.popover-title').hide()
  }

  Popover.prototype.hasContent = function () {
    return this.getTitle() || this.getContent()
  }

  Popover.prototype.getContent = function () {
    var $e = this.$element
    var o  = this.options

    return $e.attr('data-content')
      || (typeof o.content == 'function' ?
            o.content.call($e[0]) :
            o.content)
  }

  Popover.prototype.arrow = function () {
    return this.$arrow = this.$arrow || this.tip().find('.arrow')
  }

  Popover.prototype.tip = function () {
    if (!this.$tip) this.$tip = $(this.options.template)
    return this.$tip
  }


  // POPOVER PLUGIN DEFINITION
  // =========================

  var old = $.fn.popover

  $.fn.popover = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.popover')
      var options = typeof option == 'object' && option

      if (!data && option == 'destroy') return
      if (!data) $this.data('bs.popover', (data = new Popover(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.popover.Constructor = Popover


  // POPOVER NO CONFLICT
  // ===================

  $.fn.popover.noConflict = function () {
    $.fn.popover = old
    return this
  }

}(jQuery);

/* ========================================================================
 * Bootstrap: scrollspy.js v3.1.1
 * http://getbootstrap.com/javascript/#scrollspy
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // SCROLLSPY CLASS DEFINITION
  // ==========================

  function ScrollSpy(element, options) {
    var href
    var process  = $.proxy(this.process, this)

    this.$element       = $(element).is('body') ? $(window) : $(element)
    this.$body          = $('body')
    this.$scrollElement = this.$element.on('scroll.bs.scroll-spy.data-api', process)
    this.options        = $.extend({}, ScrollSpy.DEFAULTS, options)
    this.selector       = (this.options.target
      || ((href = $(element).attr('href')) && href.replace(/.*(?=#[^\s]+$)/, '')) //strip for ie7
      || '') + ' .nav li > a'
    this.offsets        = $([])
    this.targets        = $([])
    this.activeTarget   = null

    this.refresh()
    this.process()
  }

  ScrollSpy.DEFAULTS = {
    offset: 10
  }

  ScrollSpy.prototype.refresh = function () {
    var offsetMethod = this.$element[0] == window ? 'offset' : 'position'

    this.offsets = $([])
    this.targets = $([])

    var self     = this
    var $targets = this.$body
      .find(this.selector)
      .map(function () {
        var $el   = $(this)
        var href  = $el.data('target') || $el.attr('href')
        var $href = /^#./.test(href) && $(href)

        return ($href
          && $href.length
          && $href.is(':visible')
          && [[ $href[offsetMethod]().top + (!$.isWindow(self.$scrollElement.get(0)) && self.$scrollElement.scrollTop()), href ]]) || null
      })
      .sort(function (a, b) { return a[0] - b[0] })
      .each(function () {
        self.offsets.push(this[0])
        self.targets.push(this[1])
      })
  }

  ScrollSpy.prototype.process = function () {
    var scrollTop    = this.$scrollElement.scrollTop() + this.options.offset
    var scrollHeight = this.$scrollElement[0].scrollHeight || this.$body[0].scrollHeight
    var maxScroll    = scrollHeight - this.$scrollElement.height()
    var offsets      = this.offsets
    var targets      = this.targets
    var activeTarget = this.activeTarget
    var i

    if (scrollTop >= maxScroll) {
      return activeTarget != (i = targets.last()[0]) && this.activate(i)
    }

    if (activeTarget && scrollTop <= offsets[0]) {
      return activeTarget != (i = targets[0]) && this.activate(i)
    }

    for (i = offsets.length; i--;) {
      activeTarget != targets[i]
        && scrollTop >= offsets[i]
        && (!offsets[i + 1] || scrollTop <= offsets[i + 1])
        && this.activate( targets[i] )
    }
  }

  ScrollSpy.prototype.activate = function (target) {
    this.activeTarget = target

    $(this.selector)
      .parentsUntil(this.options.target, '.active')
      .removeClass('active')

    var selector = this.selector +
        '[data-target="' + target + '"],' +
        this.selector + '[href="' + target + '"]'

    var active = $(selector)
      .parents('li')
      .addClass('active')

    if (active.parent('.dropdown-menu').length) {
      active = active
        .closest('li.dropdown')
        .addClass('active')
    }

    active.trigger('activate.bs.scrollspy')
  }


  // SCROLLSPY PLUGIN DEFINITION
  // ===========================

  var old = $.fn.scrollspy

  $.fn.scrollspy = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.scrollspy')
      var options = typeof option == 'object' && option

      if (!data) $this.data('bs.scrollspy', (data = new ScrollSpy(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.scrollspy.Constructor = ScrollSpy


  // SCROLLSPY NO CONFLICT
  // =====================

  $.fn.scrollspy.noConflict = function () {
    $.fn.scrollspy = old
    return this
  }


  // SCROLLSPY DATA-API
  // ==================

  $(window).on('load', function () {
    $('[data-spy="scroll"]').each(function () {
      var $spy = $(this)
      $spy.scrollspy($spy.data())
    })
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: tab.js v3.1.1
 * http://getbootstrap.com/javascript/#tabs
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // TAB CLASS DEFINITION
  // ====================

  var Tab = function (element) {
    this.element = $(element)
  }

  Tab.prototype.show = function () {
    var $this    = this.element
    var $ul      = $this.closest('ul:not(.dropdown-menu)')
    var selector = $this.data('target')

    if (!selector) {
      selector = $this.attr('href')
      selector = selector && selector.replace(/.*(?=#[^\s]*$)/, '') //strip for ie7
    }

    if ($this.parent('li').hasClass('active')) return

    var previous = $ul.find('.active:last a')[0]
    var e        = $.Event('show.bs.tab', {
      relatedTarget: previous
    })

    $this.trigger(e)

    if (e.isDefaultPrevented()) return

    var $target = $(selector)

    this.activate($this.parent('li'), $ul)
    this.activate($target, $target.parent(), function () {
      $this.trigger({
        type: 'shown.bs.tab',
        relatedTarget: previous
      })
    })
  }

  Tab.prototype.activate = function (element, container, callback) {
    var $active    = container.find('> .active')
    var transition = callback
      && $.support.transition
      && $active.hasClass('fade')

    function next() {
      $active
        .removeClass('active')
        .find('> .dropdown-menu > .active')
        .removeClass('active')

      element.addClass('active')

      if (transition) {
        element[0].offsetWidth // reflow for transition
        element.addClass('in')
      } else {
        element.removeClass('fade')
      }

      if (element.parent('.dropdown-menu')) {
        element.closest('li.dropdown').addClass('active')
      }

      callback && callback()
    }

    transition ?
      $active
        .one($.support.transition.end, next)
        .emulateTransitionEnd(150) :
      next()

    $active.removeClass('in')
  }


  // TAB PLUGIN DEFINITION
  // =====================

  var old = $.fn.tab

  $.fn.tab = function ( option ) {
    return this.each(function () {
      var $this = $(this)
      var data  = $this.data('bs.tab')

      if (!data) $this.data('bs.tab', (data = new Tab(this)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.tab.Constructor = Tab


  // TAB NO CONFLICT
  // ===============

  $.fn.tab.noConflict = function () {
    $.fn.tab = old
    return this
  }


  // TAB DATA-API
  // ============

  $(document).on('click.bs.tab.data-api', '[data-toggle="tab"], [data-toggle="pill"]', function (e) {
    e.preventDefault()
    $(this).tab('show')
  })

}(jQuery);

/* ========================================================================
 * Bootstrap: affix.js v3.1.1
 * http://getbootstrap.com/javascript/#affix
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  'use strict';

  // AFFIX CLASS DEFINITION
  // ======================

  var Affix = function (element, options) {
    this.options = $.extend({}, Affix.DEFAULTS, options)
    this.$window = $(window)
      .on('scroll.bs.affix.data-api', $.proxy(this.checkPosition, this))
      .on('click.bs.affix.data-api',  $.proxy(this.checkPositionWithEventLoop, this))

    this.$element     = $(element)
    this.affixed      =
    this.unpin        =
    this.pinnedOffset = null

    this.checkPosition()
  }

  Affix.RESET = 'affix affix-top affix-bottom'

  Affix.DEFAULTS = {
    offset: 0
  }

  Affix.prototype.getPinnedOffset = function () {
    if (this.pinnedOffset) return this.pinnedOffset
    this.$element.removeClass(Affix.RESET).addClass('affix')
    var scrollTop = this.$window.scrollTop()
    var position  = this.$element.offset()
    return (this.pinnedOffset = position.top - scrollTop)
  }

  Affix.prototype.checkPositionWithEventLoop = function () {
    setTimeout($.proxy(this.checkPosition, this), 1)
  }

  Affix.prototype.checkPosition = function () {
    if (!this.$element.is(':visible')) return

    var scrollHeight = $(document).height()
    var scrollTop    = this.$window.scrollTop()
    var position     = this.$element.offset()
    var offset       = this.options.offset
    var offsetTop    = offset.top
    var offsetBottom = offset.bottom

    if (this.affixed == 'top') position.top += scrollTop

    if (typeof offset != 'object')         offsetBottom = offsetTop = offset
    if (typeof offsetTop == 'function')    offsetTop    = offset.top(this.$element)
    if (typeof offsetBottom == 'function') offsetBottom = offset.bottom(this.$element)

    var affix = this.unpin   != null && (scrollTop + this.unpin <= position.top) ? false :
                offsetBottom != null && (position.top + this.$element.height() >= scrollHeight - offsetBottom) ? 'bottom' :
                offsetTop    != null && (scrollTop <= offsetTop) ? 'top' : false

    if (this.affixed === affix) return
    if (this.unpin) this.$element.css('top', '')

    var affixType = 'affix' + (affix ? '-' + affix : '')
    var e         = $.Event(affixType + '.bs.affix')

    this.$element.trigger(e)

    if (e.isDefaultPrevented()) return

    this.affixed = affix
    this.unpin = affix == 'bottom' ? this.getPinnedOffset() : null

    this.$element
      .removeClass(Affix.RESET)
      .addClass(affixType)
      .trigger($.Event(affixType.replace('affix', 'affixed')))

    if (affix == 'bottom') {
      this.$element.offset({ top: scrollHeight - offsetBottom - this.$element.height() })
    }
  }


  // AFFIX PLUGIN DEFINITION
  // =======================

  var old = $.fn.affix

  $.fn.affix = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.affix')
      var options = typeof option == 'object' && option

      if (!data) $this.data('bs.affix', (data = new Affix(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.affix.Constructor = Affix


  // AFFIX NO CONFLICT
  // =================

  $.fn.affix.noConflict = function () {
    $.fn.affix = old
    return this
  }


  // AFFIX DATA-API
  // ==============

  $(window).on('load', function () {
    $('[data-spy="affix"]').each(function () {
      var $spy = $(this)
      var data = $spy.data()

      data.offset = data.offset || {}

      if (data.offsetBottom) data.offset.bottom = data.offsetBottom
      if (data.offsetTop)    data.offset.top    = data.offsetTop

      $spy.affix(data)
    })
  })

}(jQuery);

/*
 * qTip2 - Pretty powerful tooltips - v2.0.1-105
 * http://qtip2.com
 *
 * Copyright (c) 2013 Craig Michael Thompson
 * Released under the MIT, GPL licenses
 * http://jquery.org/license
 *
 * Date: Sun Jun 2 2013 02:19 UTC+0000
 * Plugins: tips modal viewport svg imagemap ie6
 * Styles: basic css3
 */
/*global window: false, jQuery: false, console: false, define: false */

/* Cache window, document, undefined */
(function( window, document, undefined ) {

// Uses AMD or browser globals to create a jQuery plugin.
(function( factory ) {
  "use strict";
  if(typeof define === 'function' && define.amd) {
    define(['jquery'], factory);
  }
  else if(jQuery && !jQuery.fn.qtip) {
    factory(jQuery);
  }
}
(function($) {
  /* This currently causes issues with Safari 6, so for it's disabled */
  //"use strict"; // (Dis)able ECMAScript "strict" operation for this function. See more: http://ejohn.org/blog/ecmascript-5-strict-mode-json-and-more/

;// Munge the primitives - Paul Irish tip
var TRUE = true,
FALSE = false,
NULL = null,

// Common variables
X = 'x', Y = 'y',
WIDTH = 'width',
HEIGHT = 'height',

// Positioning sides
TOP = 'top',
LEFT = 'left',
BOTTOM = 'bottom',
RIGHT = 'right',
CENTER = 'center',

// Position adjustment types
FLIP = 'flip',
FLIPINVERT = 'flipinvert',
SHIFT = 'shift',

// Shortcut vars
QTIP, PROTOTYPE, CORNER, CHECKS,
PLUGINS = {},
NAMESPACE = 'qtip',
ATTR_HAS = 'data-hasqtip',
ATTR_ID = 'data-qtip-id',
WIDGET = ['ui-widget', 'ui-tooltip'],
SELECTOR = '.'+NAMESPACE,
INACTIVE_EVENTS = 'click dblclick mousedown mouseup mousemove mouseleave mouseenter'.split(' '),

CLASS_FIXED = NAMESPACE+'-fixed',
CLASS_DEFAULT = NAMESPACE + '-default',
CLASS_FOCUS = NAMESPACE + '-focus',
CLASS_HOVER = NAMESPACE + '-hover',
CLASS_DISABLED = NAMESPACE+'-disabled',

replaceSuffix = '_replacedByqTip',
oldtitle = 'oldtitle',
trackingBound;

// Browser detection
BROWSER = {
  /*
   * IE version detection
   *
   * Adapted from: http://ajaxian.com/archives/attack-of-the-ie-conditional-comment
   * Credit to James Padolsey for the original implemntation!
   */
  ie: (function(){
    var v = 3, div = document.createElement('div');
    while ((div.innerHTML = '<!--[if gt IE '+(++v)+']><i></i><![endif]-->')) {
      if(!div.getElementsByTagName('i')[0]) { break; }
    }
    return v > 4 ? v : NaN;
  }()),

  /*
   * iOS version detection
   */
  iOS: parseFloat(
    ('' + (/CPU.*OS ([0-9_]{1,5})|(CPU like).*AppleWebKit.*Mobile/i.exec(navigator.userAgent) || [0,''])[1])
    .replace('undefined', '3_2').replace('_', '.').replace('_', '')
  ) || FALSE
};

;function QTip(target, options, id, attr) {
  // Elements and ID
  this.id = id;
  this.target = target;
  this.tooltip = NULL;
  this.elements = elements = { target: target };

  // Internal constructs
  this._id = NAMESPACE + '-' + id;
  this.timers = { img: {} };
  this.options = options;
  this.plugins = {};

  // Cache object
  this.cache = cache = {
    event: {},
    target: $(),
    disabled: FALSE,
    attr: attr,
    onTooltip: FALSE,
    lastClass: ''
  };

  // Set the initial flags
  this.rendered = this.destroyed = this.disabled = this.waiting =
    this.hiddenDuringWait = this.positioning = this.triggering = FALSE;
}
PROTOTYPE = QTip.prototype;

PROTOTYPE.render = function(show) {
  if(this.rendered || this.destroyed) { return this; } // If tooltip has already been rendered, exit

  var self = this,
    options = this.options,
    cache = this.cache,
    elements = this.elements,
    text = options.content.text,
    title = options.content.title,
    button = options.content.button,
    posOptions = options.position,
    namespace = '.'+this._id+' ',
    deferreds = [];

  // Add ARIA attributes to target
  $.attr(this.target[0], 'aria-describedby', this._id);

  // Create tooltip element
  this.tooltip = elements.tooltip = tooltip = $('<div/>', {
    'id': this._id,
    'class': [ NAMESPACE, CLASS_DEFAULT, options.style.classes, NAMESPACE + '-pos-' + options.position.my.abbrev() ].join(' '),
    'width': options.style.width || '',
    'height': options.style.height || '',
    'tracking': posOptions.target === 'mouse' && posOptions.adjust.mouse,

    /* ARIA specific attributes */
    'role': 'alert',
    'aria-live': 'polite',
    'aria-atomic': FALSE,
    'aria-describedby': this._id + '-content',
    'aria-hidden': TRUE
  })
  .toggleClass(CLASS_DISABLED, this.disabled)
  .attr(ATTR_ID, this.id)
  .data(NAMESPACE, this)
  .appendTo(posOptions.container)
  .append(
    // Create content element
    elements.content = $('<div />', {
      'class': NAMESPACE + '-content',
      'id': this._id + '-content',
      'aria-atomic': TRUE
    })
  );

  // Set rendered flag and prevent redundant reposition calls for now
  this.rendered = -1;
  this.positioning = TRUE;

  // Create title...
  if(title) {
    this._createTitle();

    // Update title only if its not a callback (called in toggle if so)
    if(!$.isFunction(title)) {
      deferreds.push( this._updateTitle(title, FALSE) );
    }
  }

  // Create button
  if(button) { this._createButton(); }

  // Set proper rendered flag and update content if not a callback function (called in toggle)
  if(!$.isFunction(text)) {
    deferreds.push( this._updateContent(text, FALSE) );
  }
  this.rendered = TRUE;

  // Setup widget classes
  this._setWidget();

  // Assign passed event callbacks (before plugins!)
  $.each(options.events, function(name, callback) {
    $.isFunction(callback) && tooltip.bind(
      (name === 'toggle' ? ['tooltipshow','tooltiphide'] : ['tooltip'+name])
        .join(namespace)+namespace, callback
    );
  });

  // Initialize 'render' plugins
  $.each(PLUGINS, function(name) {
    var instance;
    if(this.initialize === 'render' && (instance = this(self))) {
      self.plugins[name] = instance;
    }
  });

  // Assign events
  this._assignEvents();

  // When deferreds have completed
  $.when.apply($, deferreds).then(function() {
    // tooltiprender event
    self._trigger('render');

    // Reset flags
    self.positioning = FALSE;

    // Show tooltip if not hidden during wait period
    if(!self.hiddenDuringWait && (options.show.ready || show)) {
      self.toggle(TRUE, cache.event, FALSE);
    }
    self.hiddenDuringWait = FALSE;
  });

  // Expose API
  QTIP.api[this.id] = this;

  return this;
};

PROTOTYPE.destroy = function(immediate) {
  // Set flag the signify destroy is taking place to plugins
  // and ensure it only gets destroyed once!
  if(this.destroyed) { return this.target; }

  function process() {
    if(this.destroyed) { return; }
    this.destroyed = TRUE;

    var target = this.target,
      title = target.attr(oldtitle);

    // Destroy tooltip if rendered
    if(this.rendered) {
      this.tooltip.stop(1,0).find('*').remove().end().remove();
    }

    // Destroy all plugins
    $.each(this.plugins, function(name) {
      this.destroy && this.destroy();
    });

    // Clear timers and remove bound events
    clearTimeout(this.timers.show);
    clearTimeout(this.timers.hide);
    this._unassignEvents();

    // Remove api object and ARIA attributes
    target.removeData(NAMESPACE).removeAttr(ATTR_ID)
      .removeAttr('aria-describedby');

    // Reset old title attribute if removed
    if(this.options.suppress && title) {
      target.attr('title', title).removeAttr(oldtitle);
    }

    // Remove qTip events associated with this API
    this._unbind(target);

    // Remove ID from used id objects, and delete object references
    // for better garbage collection and leak protection
    this.options = this.elements = this.cache = this.timers =
      this.plugins = this.mouse = NULL;

    // Delete epoxsed API object
    delete QTIP.api[this.id];
  }

  // If an immediate destory is needed
  if(immediate !== TRUE && this.rendered) {
    tooltip.one('tooltiphidden', $.proxy(process, this));
    !this.triggering && this.hide();
  }

  // If we're not in the process of hiding... process
  else { process.call(this); }

  return this.target;
};

;function invalidOpt(a) {
  return a === NULL || $.type(a) !== 'object';
}

function invalidContent(c) {
  return !( $.isFunction(c) || (c && c.attr) || c.length || ($.type(c) === 'object' && (c.jquery || c.then) ));
}

// Option object sanitizer
function sanitizeOptions(opts) {
  var content, text, ajax, once;

  if(invalidOpt(opts)) { return FALSE; }

  if(invalidOpt(opts.metadata)) {
    opts.metadata = { type: opts.metadata };
  }

  if('content' in opts) {
    content = opts.content;

    if(invalidOpt(content) || content.jquery || content.done) {
      content = opts.content = {
        text: (text = invalidContent(content) ? FALSE : content)
      };
    }
    else { text = content.text; }

    // DEPRECATED - Old content.ajax plugin functionality
    // Converts it into the proper Deferred syntax
    if('ajax' in content) {
      ajax = content.ajax;
      once = ajax && ajax.once !== FALSE;
      delete content.ajax;

      content.text = function(event, api) {
        var loading = text || $(this).attr(api.options.content.attr) || 'Loading...',

        deferred = $.ajax(
          $.extend({}, ajax, { context: api })
        )
        .then(ajax.success, NULL, ajax.error)
        .then(function(content) {
          if(content && once) { api.set('content.text', content); }
          return content;
        },
        function(xhr, status, error) {
          if(api.destroyed || xhr.status === 0) { return; }
          api.set('content.text', status + ': ' + error);
        });

        return !once ? (api.set('content.text', loading), deferred) : loading;
      };
    }

    if('title' in content) {
      if(!invalidOpt(content.title)) {
        content.button = content.title.button;
        content.title = content.title.text;
      }

      if(invalidContent(content.title || FALSE)) {
        content.title = FALSE;
      }
    }
  }

  if('position' in opts && invalidOpt(opts.position)) {
    opts.position = { my: opts.position, at: opts.position };
  }

  if('show' in opts && invalidOpt(opts.show)) {
    opts.show = opts.show.jquery ? { target: opts.show } :
      opts.show === TRUE ? { ready: TRUE } : { event: opts.show };
  }

  if('hide' in opts && invalidOpt(opts.hide)) {
    opts.hide = opts.hide.jquery ? { target: opts.hide } : { event: opts.hide };
  }

  if('style' in opts && invalidOpt(opts.style)) {
    opts.style = { classes: opts.style };
  }

  // Sanitize plugin options
  $.each(PLUGINS, function() {
    this.sanitize && this.sanitize(opts);
  });

  return opts;
}

// Setup builtin .set() option checks
CHECKS = PROTOTYPE.checks = {
  builtin: {
    // Core checks
    '^id$': function(obj, o, v, prev) {
      var id = v === TRUE ? QTIP.nextid : v,
        new_id = NAMESPACE + '-' + id;

      if(id !== FALSE && id.length > 0 && !$('#'+new_id).length) {
        this._id = new_id;

        if(this.rendered) {
          this.tooltip[0].id = this._id;
          this.elements.content[0].id = this._id + '-content';
          this.elements.title[0].id = this._id + '-title';
        }
      }
      else { obj[o] = prev; }
    },
    '^prerender': function(obj, o, v) {
      v && !this.rendered && this.render(this.options.show.ready);
    },

    // Content checks
    '^content.text$': function(obj, o, v) {
      this._updateContent(v);
    },
    '^content.attr$': function(obj, o, v, prev) {
      if(this.options.content.text === this.target.attr(prev)) {
        this._updateContent( this.target.attr(v) );
      }
    },
    '^content.title$': function(obj, o, v) {
      // Remove title if content is null
      if(!v) { return this._removeTitle(); }

      // If title isn't already created, create it now and update
      v && !this.elements.title && this._createTitle();
      this._updateTitle(v);
    },
    '^content.button$': function(obj, o, v) {
      this._updateButton(v);
    },
    '^content.title.(text|button)$': function(obj, o, v) {
      this.set('content.'+o, v); // Backwards title.text/button compat
    },

    // Position checks
    '^position.(my|at)$': function(obj, o, v){
      'string' === typeof v && (obj[o] = new CORNER(v, o === 'at'));
    },
    '^position.container$': function(obj, o, v){
      this.tooltip.appendTo(v);
    },

    // Show checks
    '^show.ready$': function(obj, o, v) {
      v && (!this.rendered && this.render(TRUE) || this.toggle(TRUE));
    },

    // Style checks
    '^style.classes$': function(obj, o, v, p) {
      this.tooltip.removeClass(p).addClass(v);
    },
    '^style.width|height': function(obj, o, v) {
      this.tooltip.css(o, v);
    },
    '^style.widget|content.title': function() {
      this._setWidget();
    },
    '^style.def': function(obj, o, v) {
      this.tooltip.toggleClass(CLASS_DEFAULT, !!v);
    },

    // Events check
    '^events.(render|show|move|hide|focus|blur)$': function(obj, o, v) {
      tooltip[($.isFunction(v) ? '' : 'un') + 'bind']('tooltip'+o, v);
    },

    // Properties which require event reassignment
    '^(show|hide|position).(event|target|fixed|inactive|leave|distance|viewport|adjust)': function() {
      var posOptions = this.options.position;

      // Set tracking flag
      tooltip.attr('tracking', posOptions.target === 'mouse' && posOptions.adjust.mouse);

      // Reassign events
      this._unassignEvents();
      this._assignEvents();
    }
  }
};

// Dot notation converter
function convertNotation(options, notation) {
  var i = 0, obj, option = options,

  // Split notation into array
  levels = notation.split('.');

  // Loop through
  while( option = option[ levels[i++] ] ) {
    if(i < levels.length) { obj = option; }
  }

  return [obj || options, levels.pop()];
}

PROTOTYPE.get = function(notation) {
  if(this.destroyed) { return this; }

  var o = convertNotation(this.options, notation.toLowerCase()),
    result = o[0][ o[1] ];

  return result.precedance ? result.string() : result;
};

function setCallback(notation, args) {
  var category, rule, match;

  for(category in this.checks) {
    for(rule in this.checks[category]) {
      if(match = (new RegExp(rule, 'i')).exec(notation)) {
        args.push(match);

        if(category === 'builtin' || this.plugins[category]) {
          this.checks[category][rule].apply(
            this.plugins[category] || this, args
          );
        }
      }
    }
  }
}

var rmove = /^position\.(my|at|adjust|target|container|viewport)|style|content|show\.ready/i,
  rrender = /^prerender|show\.ready/i;

PROTOTYPE.set = function(option, value) {
  if(this.destroyed) { return this; }

  var rendered = this.rendered,
    reposition = FALSE,
    options = this.options,
    checks = this.checks,
    name;

  // Convert singular option/value pair into object form
  if('string' === typeof option) {
    name = option; option = {}; option[name] = value;
  }
  else { option = $.extend({}, option); }

  // Set all of the defined options to their new values
  $.each(option, function(notation, value) {
    if(!rendered && !rrender.test(notation)) {
      delete option[notation]; return;
    }

    // Set new obj value
    var obj = convertNotation(options, notation.toLowerCase()), previous;
    previous = obj[0][ obj[1] ];
    obj[0][ obj[1] ] = value && value.nodeType ? $(value) : value;

    // Also check if we need to reposition
    reposition = rmove.test(notation) || reposition;

    // Set the new params for the callback
    option[notation] = [obj[0], obj[1], value, previous];
  });

  // Re-sanitize options
  sanitizeOptions(options);

  /*
   * Execute any valid callbacks for the set options
   * Also set positioning flag so we don't get loads of redundant repositioning calls.
   */
  this.positioning = TRUE;
  $.each(option, $.proxy(setCallback, this));
  this.positioning = FALSE;

  // Update position if needed
  if(this.rendered && this.tooltip[0].offsetWidth > 0 && reposition) {
    this.reposition( options.position.target === 'mouse' ? NULL : this.cache.event );
  }

  return this;
};

;PROTOTYPE._update = function(content, element, reposition) {
  var self = this,
    cache = this.cache;

  // Make sure tooltip is rendered and content is defined. If not return
  if(!this.rendered || !content) { return FALSE; }

  // Use function to parse content
  if($.isFunction(content)) {
    content = content.call(this.elements.target, cache.event, this) || '';
  }

  // Handle deferred content
  if($.isFunction(content.then)) {
    cache.waiting = TRUE;
    return content.then(function(c) {
      cache.waiting = FALSE;
      return self._update(c, element, reposition);
    }, NULL, function(e) {
      return self._update(e, element, reposition);
    });
  }

  // If content is null... return false
  if(content === FALSE || (!content && content !== '')) { return FALSE; }

  // Append new content if its a DOM array and show it if hidden
  if(content.jquery && content.length > 0) {
    element.empty().append( content.css({ display: 'block' }) );
  }

  // Content is a regular string, insert the new content
  else { element.html(content); }

  // Ensure images have loaded...
  cache.waiting = TRUE;
  return element.imagesLoaded()
    .done(function(images) {
      cache.waiting = FALSE;

      // Reposition if rendered
      if(reposition !== FALSE && self.rendered && self.tooltip[0].offsetWidth > 0) {
        self.reposition(cache.event, !images.length);
      }
    })
    .promise();
};

PROTOTYPE._updateContent = function(content, reposition) {
  this._update(content, this.elements.content, reposition);
};

PROTOTYPE._updateTitle = function(content, reposition) {
  if(this._update(content, this.elements.title, reposition) === FALSE) {
    this._removeTitle(FALSE);
  }
};

PROTOTYPE._createTitle = function()
{
  var elements = this.elements,
    id = this._id+'-title';

  // Destroy previous title element, if present
  if(elements.titlebar) { this._removeTitle(); }

  // Create title bar and title elements
  elements.titlebar = $('<div />', {
    'class': NAMESPACE + '-titlebar ' + (this.options.style.widget ? createWidgetClass('header') : '')
  })
  .append(
    elements.title = $('<div />', {
      'id': id,
      'class': NAMESPACE + '-title',
      'aria-atomic': TRUE
    })
  )
  .insertBefore(elements.content)

  // Button-specific events
  .delegate('.qtip-close', 'mousedown keydown mouseup keyup mouseout', function(event) {
    $(this).toggleClass('ui-state-active ui-state-focus', event.type.substr(-4) === 'down');
  })
  .delegate('.qtip-close', 'mouseover mouseout', function(event){
    $(this).toggleClass('ui-state-hover', event.type === 'mouseover');
  });

  // Create button if enabled
  if(this.options.content.button) { this._createButton(); }
};

PROTOTYPE._removeTitle = function(reposition)
{
  var elements = this.elements;

  if(elements.title) {
    elements.titlebar.remove();
    elements.titlebar = elements.title = elements.button = NULL;

    // Reposition if enabled
    if(reposition !== FALSE) { this.reposition(); }
  }
};

;PROTOTYPE.reposition = function(event, effect) {
  if(!this.rendered || this.positioning || this.destroyed) { return this; }

  // Set positioning flag
  this.positioning = TRUE;

  var cache = this.cache,
    tooltip = this.tooltip,
    posOptions = this.options.position,
    target = posOptions.target,
    my = posOptions.my,
    at = posOptions.at,
    viewport = posOptions.viewport,
    container = posOptions.container,
    adjust = posOptions.adjust,
    method = adjust.method.split(' '),
    elemWidth = tooltip.outerWidth(FALSE),
    elemHeight = tooltip.outerHeight(FALSE),
    targetWidth = 0,
    targetHeight = 0,
    type = tooltip.css('position'),
    position = { left: 0, top: 0 },
    visible = tooltip[0].offsetWidth > 0,
    isScroll = event && event.type === 'scroll',
    win = $(window),
    doc = container[0].ownerDocument,
    mouse = this.mouse,
    pluginCalculations, offset;

  // Check if absolute position was passed
  if($.isArray(target) && target.length === 2) {
    // Force left top and set position
    at = { x: LEFT, y: TOP };
    position = { left: target[0], top: target[1] };
  }

  // Check if mouse was the target
  else if(target === 'mouse' && ((event && event.pageX) || cache.event.pageX)) {
    // Force left top to allow flipping
    at = { x: LEFT, y: TOP };

    // Use cached event if one isn't available for positioning
    event = mouse && mouse.pageX && (adjust.mouse || !event || !event.pageX) ? mouse :
      (event && (event.type === 'resize' || event.type === 'scroll') ? cache.event :
      event && event.pageX && event.type === 'mousemove' ? event :
      (!adjust.mouse || this.options.show.distance) && cache.origin && cache.origin.pageX ? cache.origin :
      event) || event || cache.event || mouse || {};

    // Calculate body and container offset and take them into account below
    if(type !== 'static') { position = container.offset(); }
    if(doc.body.offsetWidth !== (window.innerWidth || doc.documentElement.clientWidth)) { offset = $(doc.body).offset(); }

    // Use event coordinates for position
    position = {
      left: event.pageX - position.left + (offset && offset.left || 0),
      top: event.pageY - position.top + (offset && offset.top || 0)
    };

    // Scroll events are a pain, some browsers
    if(adjust.mouse && isScroll) {
      position.left -= mouse.scrollX - win.scrollLeft();
      position.top -= mouse.scrollY - win.scrollTop();
    }
  }

  // Target wasn't mouse or absolute...
  else {
    // Check if event targetting is being used
    if(target === 'event' && event && event.target && event.type !== 'scroll' && event.type !== 'resize') {
      cache.target = $(event.target);
    }
    else if(target !== 'event'){
      cache.target = $(target.jquery ? target : elements.target);
    }
    target = cache.target;

    // Parse the target into a jQuery object and make sure there's an element present
    target = $(target).eq(0);
    if(target.length === 0) { return this; }

    // Check if window or document is the target
    else if(target[0] === document || target[0] === window) {
      targetWidth = BROWSER.iOS ? window.innerWidth : target.width();
      targetHeight = BROWSER.iOS ? window.innerHeight : target.height();

      if(target[0] === window) {
        position = {
          top: (viewport || target).scrollTop(),
          left: (viewport || target).scrollLeft()
        };
      }
    }

    // Check if the target is an <AREA> element
    else if(PLUGINS.imagemap && target.is('area')) {
      pluginCalculations = PLUGINS.imagemap(this, target, at, PLUGINS.viewport ? method : FALSE);
    }

    // Check if the target is an SVG element
    else if(PLUGINS.svg && target[0].ownerSVGElement) {
      pluginCalculations = PLUGINS.svg(this, target, at, PLUGINS.viewport ? method : FALSE);
    }

    // Otherwise use regular jQuery methods
    else {
      targetWidth = target.outerWidth(FALSE);
      targetHeight = target.outerHeight(FALSE);
      position = target.offset();
    }

    // Parse returned plugin values into proper variables
    if(pluginCalculations) {
      targetWidth = pluginCalculations.width;
      targetHeight = pluginCalculations.height;
      offset = pluginCalculations.offset;
      position = pluginCalculations.position;
    }

    // Adjust position to take into account offset parents
    position = this.reposition.offset(target, position, container);

    // Adjust for position.fixed tooltips (and also iOS scroll bug in v3.2-4.0 & v4.3-4.3.2)
    if((BROWSER.iOS > 3.1 && BROWSER.iOS < 4.1) ||
      (BROWSER.iOS >= 4.3 && BROWSER.iOS < 4.33) ||
      (!BROWSER.iOS && type === 'fixed')
    ){
      position.left -= win.scrollLeft();
      position.top -= win.scrollTop();
    }

    // Adjust position relative to target
    if(!pluginCalculations || (pluginCalculations && pluginCalculations.adjustable !== FALSE)) {
      position.left += at.x === RIGHT ? targetWidth : at.x === CENTER ? targetWidth / 2 : 0;
      position.top += at.y === BOTTOM ? targetHeight : at.y === CENTER ? targetHeight / 2 : 0;
    }
  }

  // Adjust position relative to tooltip
  position.left += adjust.x + (my.x === RIGHT ? -elemWidth : my.x === CENTER ? -elemWidth / 2 : 0);
  position.top += adjust.y + (my.y === BOTTOM ? -elemHeight : my.y === CENTER ? -elemHeight / 2 : 0);

  // Use viewport adjustment plugin if enabled
  if(PLUGINS.viewport) {
    position.adjusted = PLUGINS.viewport(
      this, position, posOptions, targetWidth, targetHeight, elemWidth, elemHeight
    );

    // Apply offsets supplied by positioning plugin (if used)
    if(offset && position.adjusted.left) { position.left += offset.left; }
    if(offset && position.adjusted.top) {  position.top += offset.top; }
  }

  // Viewport adjustment is disabled, set values to zero
  else { position.adjusted = { left: 0, top: 0 }; }

  // tooltipmove event
  if(!this._trigger('move', [position, viewport.elem || viewport], event)) { return this; }
  delete position.adjusted;

  // If effect is disabled, target it mouse, no animation is defined or positioning gives NaN out, set CSS directly
  if(effect === FALSE || !visible || isNaN(position.left) || isNaN(position.top) || target === 'mouse' || !$.isFunction(posOptions.effect)) {
    tooltip.css(position);
  }

  // Use custom function if provided
  else if($.isFunction(posOptions.effect)) {
    posOptions.effect.call(tooltip, this, $.extend({}, position));
    tooltip.queue(function(next) {
      // Reset attributes to avoid cross-browser rendering bugs
      $(this).css({ opacity: '', height: '' });
      if(BROWSER.ie) { this.style.removeAttribute('filter'); }

      next();
    });
  }

  // Set positioning flag
  this.positioning = FALSE;

  return this;
};

// Custom (more correct for qTip!) offset calculator
PROTOTYPE.reposition.offset = function(elem, pos, container) {
  if(!container[0]) { return pos; }

  var ownerDocument = $(elem[0].ownerDocument),
    quirks = !!BROWSER.ie && document.compatMode !== 'CSS1Compat',
    parent = container[0],
    scrolled, position, parentOffset, overflow;

  function scroll(e, i) {
    pos.left += i * e.scrollLeft();
    pos.top += i * e.scrollTop();
  }

  // Compensate for non-static containers offset
  do {
    if((position = $.css(parent, 'position')) !== 'static') {
      if(position === 'fixed') {
        parentOffset = parent.getBoundingClientRect();
        scroll(ownerDocument, -1);
      }
      else {
        parentOffset = $(parent).position();
        parentOffset.left += (parseFloat($.css(parent, 'borderLeftWidth')) || 0);
        parentOffset.top += (parseFloat($.css(parent, 'borderTopWidth')) || 0);
      }

      pos.left -= parentOffset.left + (parseFloat($.css(parent, 'marginLeft')) || 0);
      pos.top -= parentOffset.top + (parseFloat($.css(parent, 'marginTop')) || 0);

      // If this is the first parent element with an overflow of "scroll" or "auto", store it
      if(!scrolled && (overflow = $.css(parent, 'overflow')) !== 'hidden' && overflow !== 'visible') { scrolled = $(parent); }
    }
  }
  while((parent = parent.offsetParent));

  // Compensate for containers scroll if it also has an offsetParent (or in IE quirks mode)
  if(scrolled && (scrolled[0] !== ownerDocument[0] || quirks)) {
    scroll(scrolled, 1);
  }

  return pos;
};

// Corner class
var C = (CORNER = PROTOTYPE.reposition.Corner = function(corner, forceY) {
  corner = ('' + corner).replace(/([A-Z])/, ' $1').replace(/middle/gi, CENTER).toLowerCase();
  this.x = (corner.match(/left|right/i) || corner.match(/center/) || ['inherit'])[0].toLowerCase();
  this.y = (corner.match(/top|bottom|center/i) || ['inherit'])[0].toLowerCase();
  this.forceY = !!forceY;

  var f = corner.charAt(0);
  this.precedance = (f === 't' || f === 'b' ? Y : X);
}).prototype;

C.invert = function(z, center) {
  this[z] = this[z] === LEFT ? RIGHT : this[z] === RIGHT ? LEFT : center || this[z];
};

C.string = function() {
  var x = this.x, y = this.y;
  return x === y ? x : this.precedance === Y || (this.forceY && y !== 'center') ? y+' '+x : x+' '+y;
};

C.abbrev = function() {
  var result = this.string().split(' ');
  return result[0].charAt(0) + (result[1] && result[1].charAt(0) || '');
};

C.clone = function() {
  return new CORNER( this.string(), this.forceY );
};;
PROTOTYPE.toggle = function(state, event) {
  var cache = this.cache,
    options = this.options,
    tooltip = this.tooltip;

  // Try to prevent flickering when tooltip overlaps show element
  if(event) {
    if((/over|enter/).test(event.type) && (/out|leave/).test(cache.event.type) &&
      options.show.target.add(event.target).length === options.show.target.length &&
      tooltip.has(event.relatedTarget).length) {
      return this;
    }

    // Cache event
    cache.event = $.extend({}, event);
  }

  // If we're currently waiting and we've just hidden... stop it
  this.waiting && !state && (this.hiddenDuringWait = TRUE);

  // Render the tooltip if showing and it isn't already
  if(!this.rendered) { return state ? this.render(1) : this; }
  else if(this.destroyed || this.disabled) { return this; }

  var type = state ? 'show' : 'hide',
    opts = this.options[type],
    otherOpts = this.options[ !state ? 'show' : 'hide' ],
    posOptions = this.options.position,
    contentOptions = this.options.content,
    width = this.tooltip.css('width'),
    visible = this.tooltip[0].offsetWidth > 0,
    animate = state || opts.target.length === 1,
    sameTarget = !event || opts.target.length < 2 || cache.target[0] === event.target,
    identicalState, allow, showEvent, delay;

  // Detect state if valid one isn't provided
  if((typeof state).search('boolean|number')) { state = !visible; }

  // Check if the tooltip is in an identical state to the new would-be state
  identicalState = !tooltip.is(':animated') && visible === state && sameTarget;

  // Fire tooltip(show/hide) event and check if destroyed
  allow = !identicalState ? !!this._trigger(type, [90]) : NULL;

  // If the user didn't stop the method prematurely and we're showing the tooltip, focus it
  if(allow !== FALSE && state) { this.focus(event); }

  // If the state hasn't changed or the user stopped it, return early
  if(!allow || identicalState) { return this; }

  // Set ARIA hidden attribute
  $.attr(tooltip[0], 'aria-hidden', !!!state);

  // Execute state specific properties
  if(state) {
    // Store show origin coordinates
    cache.origin = $.extend({}, this.mouse);

    // Update tooltip content & title if it's a dynamic function
    if($.isFunction(contentOptions.text)) { this._updateContent(contentOptions.text, FALSE); }
    if($.isFunction(contentOptions.title)) { this._updateTitle(contentOptions.title, FALSE); }

    // Cache mousemove events for positioning purposes (if not already tracking)
    if(!trackingBound && posOptions.target === 'mouse' && posOptions.adjust.mouse) {
      $(document).bind('mousemove.'+NAMESPACE, this._storeMouse);
      trackingBound = TRUE;
    }

    // Update the tooltip position (set width first to prevent viewport/max-width issues)
    if(!width) { tooltip.css('width', tooltip.outerWidth(FALSE)); }
    this.reposition(event, arguments[2]);
    if(!width) { tooltip.css('width', ''); }

    // Hide other tooltips if tooltip is solo
    if(!!opts.solo) {
      (typeof opts.solo === 'string' ? $(opts.solo) : $(SELECTOR, opts.solo))
        .not(tooltip).not(opts.target).qtip('hide', $.Event('tooltipsolo'));
    }
  }
  else {
    // Clear show timer if we're hiding
    clearTimeout(this.timers.show);

    // Remove cached origin on hide
    delete cache.origin;

    // Remove mouse tracking event if not needed (all tracking qTips are hidden)
    if(trackingBound && !$(SELECTOR+'[tracking="true"]:visible', opts.solo).not(tooltip).length) {
      $(document).unbind('mousemove.'+NAMESPACE);
      trackingBound = FALSE;
    }

    // Blur the tooltip
    this.blur(event);
  }

  // Define post-animation, state specific properties
  after = $.proxy(function() {
    if(state) {
      // Prevent antialias from disappearing in IE by removing filter
      if(BROWSER.ie) { tooltip[0].style.removeAttribute('filter'); }

      // Remove overflow setting to prevent tip bugs
      tooltip.css('overflow', '');

      // Autofocus elements if enabled
      if('string' === typeof opts.autofocus) {
        $(this.options.show.autofocus, tooltip).focus();
      }

      // If set, hide tooltip when inactive for delay period
      this.options.show.target.trigger('qtip-'+this.id+'-inactive');
    }
    else {
      // Reset CSS states
      tooltip.css({
        display: '',
        visibility: '',
        opacity: '',
        left: '',
        top: ''
      });
    }

    // tooltipvisible/tooltiphidden events
    this._trigger(state ? 'visible' : 'hidden');
  }, this);

  // If no effect type is supplied, use a simple toggle
  if(opts.effect === FALSE || animate === FALSE) {
    tooltip[ type ]();
    after();
  }

  // Use custom function if provided
  else if($.isFunction(opts.effect)) {
    tooltip.stop(1, 1);
    opts.effect.call(tooltip, this);
    tooltip.queue('fx', function(n) {
      after(); n();
    });
  }

  // Use basic fade function by default
  else { tooltip.fadeTo(90, state ? 1 : 0, after); }

  // If inactive hide method is set, active it
  if(state) { opts.target.trigger('qtip-'+this.id+'-inactive'); }

  return this;
};

PROTOTYPE.show = function(event) { return this.toggle(TRUE, event); };

PROTOTYPE.hide = function(event) { return this.toggle(FALSE, event); };

;PROTOTYPE.focus = function(event) {
  if(!this.rendered || this.destroyed) { return this; }

  var qtips = $(SELECTOR),
    tooltip = this.tooltip,
    curIndex = parseInt(tooltip[0].style.zIndex, 10),
    newIndex = QTIP.zindex + qtips.length,
    focusedElem;

  // Only update the z-index if it has changed and tooltip is not already focused
  if(!tooltip.hasClass(CLASS_FOCUS)) {
    // tooltipfocus event
    if(this._trigger('focus', [newIndex], event)) {
      // Only update z-index's if they've changed
      if(curIndex !== newIndex) {
        // Reduce our z-index's and keep them properly ordered
        qtips.each(function() {
          if(this.style.zIndex > curIndex) {
            this.style.zIndex = this.style.zIndex - 1;
          }
        });

        // Fire blur event for focused tooltip
        qtips.filter('.' + CLASS_FOCUS).qtip('blur', event);
      }

      // Set the new z-index
      tooltip.addClass(CLASS_FOCUS)[0].style.zIndex = newIndex;
    }
  }

  return this;
};

PROTOTYPE.blur = function(event) {
  if(!this.rendered || this.destroyed) { return this; }

  // Set focused status to FALSE
  this.tooltip.removeClass(CLASS_FOCUS);

  // tooltipblur event
  this._trigger('blur', [ this.tooltip.css('zIndex') ], event);

  return this;
};

;PROTOTYPE.disable = function(state) {
  if(this.destroyed) { return this; }

  if('boolean' !== typeof state) {
    state = !(this.tooltip.hasClass(CLASS_DISABLED) || this.disabled);
  }

  if(this.rendered) {
    this.tooltip.toggleClass(CLASS_DISABLED, state)
      .attr('aria-disabled', state);
  }

  this.disabled = !!state;

  return this;
};

PROTOTYPE.enable = function() { return this.disable(FALSE); };

;PROTOTYPE._createButton = function()
{
  var self = this,
    elements = this.elements,
    tooltip = elements.tooltip,
    button = this.options.content.button,
    isString = typeof button === 'string',
    close = isString ? button : 'Close tooltip';

  if(elements.button) { elements.button.remove(); }

  // Use custom button if one was supplied by user, else use default
  if(button.jquery) {
    elements.button = button;
  }
  else {
    elements.button = $('<a />', {
      'class': 'qtip-close ' + (this.options.style.widget ? '' : NAMESPACE+'-icon'),
      'title': close,
      'aria-label': close
    })
    .prepend(
      $('<span />', {
        'class': 'ui-icon ui-icon-close',
        'html': '&times;'
      })
    );
  }

  // Create button and setup attributes
  elements.button.appendTo(elements.titlebar || tooltip)
    .attr('role', 'button')
    .click(function(event) {
      if(!tooltip.hasClass(CLASS_DISABLED)) { self.hide(event); }
      return FALSE;
    });
};

PROTOTYPE._updateButton = function(button)
{
  // Make sure tooltip is rendered and if not, return
  if(!this.rendered) { return FALSE; }

  var elem = this.elements.button;
  if(button) { this._createButton(); }
  else { elem.remove(); }
};

;// Widget class creator
function createWidgetClass(cls) {
  return WIDGET.concat('').join(cls ? '-'+cls+' ' : ' ');
}

// Widget class setter method
PROTOTYPE._setWidget = function()
{
  var on = this.options.style.widget,
    elements = this.elements,
    tooltip = elements.tooltip,
    disabled = tooltip.hasClass(CLASS_DISABLED);

  tooltip.removeClass(CLASS_DISABLED);
  CLASS_DISABLED = on ? 'ui-state-disabled' : 'qtip-disabled';
  tooltip.toggleClass(CLASS_DISABLED, disabled);

  tooltip.toggleClass('ui-helper-reset '+createWidgetClass(), on).toggleClass(CLASS_DEFAULT, this.options.style.def && !on);

  if(elements.content) {
    elements.content.toggleClass( createWidgetClass('content'), on);
  }
  if(elements.titlebar) {
    elements.titlebar.toggleClass( createWidgetClass('header'), on);
  }
  if(elements.button) {
    elements.button.toggleClass(NAMESPACE+'-icon', !on);
  }
};;function showMethod(event) {
  if(this.tooltip.hasClass(CLASS_DISABLED)) { return FALSE; }

  // Clear hide timers
  clearTimeout(this.timers.show);
  clearTimeout(this.timers.hide);

  // Start show timer
  var callback = $.proxy(function(){ this.toggle(TRUE, event); }, this);
  if(this.options.show.delay > 0) {
    this.timers.show = setTimeout(callback, this.options.show.delay);
  }
  else{ callback(); }
}

function hideMethod(event) {
  if(this.tooltip.hasClass(CLASS_DISABLED)) { return FALSE; }

  // Check if new target was actually the tooltip element
  var relatedTarget = $(event.relatedTarget),
    ontoTooltip = relatedTarget.closest(SELECTOR)[0] === this.tooltip[0],
    ontoTarget = relatedTarget[0] === this.options.show.target[0];

  // Clear timers and stop animation queue
  clearTimeout(this.timers.show);
  clearTimeout(this.timers.hide);

  // Prevent hiding if tooltip is fixed and event target is the tooltip.
  // Or if mouse positioning is enabled and cursor momentarily overlaps
  if(this !== relatedTarget[0] &&
    (this.options.position.target === 'mouse' && ontoTooltip) ||
    (this.options.hide.fixed && (
      (/mouse(out|leave|move)/).test(event.type) && (ontoTooltip || ontoTarget))
    ))
  {
    try {
      event.preventDefault();
      event.stopImmediatePropagation();
    } catch(e) {}

    return;
  }

  // If tooltip has displayed, start hide timer
  var callback = $.proxy(function(){ this.toggle(FALSE, event); }, this);
  if(this.options.hide.delay > 0) {
    this.timers.hide = setTimeout(callback, this.options.hide.delay);
  }
  else{ callback(); }
}

function inactiveMethod(event) {
  if(this.tooltip.hasClass(CLASS_DISABLED) || !this.options.hide.inactive) { return FALSE; }

  // Clear timer
  clearTimeout(this.timers.inactive);
  this.timers.inactive = setTimeout(
    $.proxy(function(){ this.hide(event); }, this), this.options.hide.inactive
  );
}

function repositionMethod(event) {
  if(this.rendered && this.tooltip[0].offsetWidth > 0) { this.reposition(event); }
}

// Store mouse coordinates
PROTOTYPE._storeMouse = function(event) {
  this.mouse = {
    pageX: event.pageX,
    pageY: event.pageY,
    type: 'mousemove',
    scrollX: window.pageXOffset || document.body.scrollLeft || document.documentElement.scrollLeft,
    scrollY: window.pageYOffset || document.body.scrollTop || document.documentElement.scrollTop
  };
};

// Bind events
PROTOTYPE._bind = function(targets, events, method, suffix, context) {
  var ns = '.' + this._id + (suffix ? '-'+suffix : '');
  events.length && $(targets).bind(
    (events.split ? events : events.join(ns + ' ')) + ns,
    $.proxy(method, context || this)
  );
};
PROTOTYPE._unbind = function(targets, suffix) {
  $(targets).unbind('.' + this._id + (suffix ? '-'+suffix : ''));
};

// Apply common event handlers using delegate (avoids excessive .bind calls!)
var ns = '.'+NAMESPACE;
function delegate(selector, events, method) {
  $(document.body).delegate(selector,
    (events.split ? events : events.join(ns + ' ')) + ns,
    function() {
      var api = QTIP.api[ $.attr(this, ATTR_ID) ];
      api && !api.disabled && method.apply(api, arguments);
    }
  );
}

$(function() {
  delegate(SELECTOR, ['mouseenter', 'mouseleave'], function(event) {
    var state = event.type === 'mouseenter',
      tooltip = $(event.currentTarget),
      target = $(event.relatedTarget || event.target),
      options = this.options;

    // On mouseenter...
    if(state) {
      // Focus the tooltip on mouseenter (z-index stacking)
      this.focus(event);

      // Clear hide timer on tooltip hover to prevent it from closing
      tooltip.hasClass(CLASS_FIXED) && !tooltip.hasClass(CLASS_DISABLED) && clearTimeout(this.timers.hide);
    }

    // On mouseleave...
    else {
      // Hide when we leave the tooltip and not onto the show target (if a hide event is set)
      if(options.position.target === 'mouse' && options.hide.event &&
        options.show.target && !target.closest(options.show.target[0]).length) {
        this.hide(event);
      }
    }

    // Add hover class
    tooltip.toggleClass(CLASS_HOVER, state);
  });

  // Define events which reset the 'inactive' event handler
  delegate('['+ATTR_ID+']', INACTIVE_EVENTS, inactiveMethod);
});

// Event trigger
PROTOTYPE._trigger = function(type, args, event) {
  var callback = $.Event('tooltip'+type);
  callback.originalEvent = (event && $.extend({}, event)) || this.cache.event || NULL;

  this.triggering = TRUE;
  this.tooltip.trigger(callback, [this].concat(args || []));
  this.triggering = FALSE;

  return !callback.isDefaultPrevented();
};

// Event assignment method
PROTOTYPE._assignEvents = function() {
  var options = this.options,
    posOptions = options.position,

    tooltip = this.tooltip,
    showTarget = options.show.target,
    hideTarget = options.hide.target,
    containerTarget = posOptions.container,
    viewportTarget = posOptions.viewport,
    documentTarget = $(document),
    bodyTarget = $(document.body),
    windowTarget = $(window),

    showEvents = options.show.event ? $.trim('' + options.show.event).split(' ') : [],
    hideEvents = options.hide.event ? $.trim('' + options.hide.event).split(' ') : [],
    toggleEvents = [];

  // Hide tooltips when leaving current window/frame (but not select/option elements)
  if(/mouse(out|leave)/i.test(options.hide.event) && options.hide.leave === 'window') {
    this._bind(documentTarget, ['mouseout', 'blur'], function(event) {
      if(!/select|option/.test(event.target.nodeName) && !event.relatedTarget) {
        this.hide(event);
      }
    });
  }

  // Enable hide.fixed by adding appropriate class
  if(options.hide.fixed) {
    hideTarget = hideTarget.add( tooltip.addClass(CLASS_FIXED) );
  }

  /*
   * Make sure hoverIntent functions properly by using mouseleave to clear show timer if
   * mouseenter/mouseout is used for show.event, even if it isn't in the users options.
   */
  else if(/mouse(over|enter)/i.test(options.show.event)) {
    this._bind(hideTarget, 'mouseleave', function() {
      clearTimeout(this.timers.show);
    });
  }

  // Hide tooltip on document mousedown if unfocus events are enabled
  if(('' + options.hide.event).indexOf('unfocus') > -1) {
    this._bind(containerTarget.closest('html'), ['mousedown', 'touchstart'], function(event) {
      var elem = $(event.target),
        enabled = this.rendered && !this.tooltip.hasClass(CLASS_DISABLED) && this.tooltip[0].offsetWidth > 0,
        isAncestor = elem.parents(SELECTOR).filter(this.tooltip[0]).length > 0;

      if(elem[0] !== this.target[0] && elem[0] !== this.tooltip[0] && !isAncestor &&
        !this.target.has(elem[0]).length && enabled
      ) {
        this.hide(event);
      }
    });
  }

  // Check if the tooltip hides when inactive
  if('number' === typeof options.hide.inactive) {
    // Bind inactive method to show target(s) as a custom event
    this._bind(showTarget, 'qtip-'+this.id+'-inactive', inactiveMethod);

    // Define events which reset the 'inactive' event handler
    this._bind(hideTarget.add(tooltip), QTIP.inactiveEvents, inactiveMethod, '-inactive');
  }

  // Apply hide events (and filter identical show events)
  hideEvents = $.map(hideEvents, function(type) {
    var showIndex = $.inArray(type, showEvents);

    // Both events and targets are identical, apply events using a toggle
    if((showIndex > -1 && hideTarget.add(showTarget).length === hideTarget.length)) {
      toggleEvents.push( showEvents.splice( showIndex, 1 )[0] ); return;
    }

    return type;
  });

  // Apply show/hide/toggle events
  this._bind(showTarget, showEvents, showMethod);
  this._bind(hideTarget, hideEvents, hideMethod);
  this._bind(showTarget, toggleEvents, function(event) {
    (this.tooltip[0].offsetWidth > 0 ? hideMethod : showMethod).call(this, event);
  });


  // Mouse movement bindings
  this._bind(showTarget.add(tooltip), 'mousemove', function(event) {
    // Check if the tooltip hides when mouse is moved a certain distance
    if('number' === typeof options.hide.distance) {
      var origin = this.cache.origin || {},
        limit = this.options.hide.distance,
        abs = Math.abs;

      // Check if the movement has gone beyond the limit, and hide it if so
      if(abs(event.pageX - origin.pageX) >= limit || abs(event.pageY - origin.pageY) >= limit) {
        this.hide(event);
      }
    }

    // Cache mousemove coords on show targets
    this._storeMouse(event);
  });

  // Mouse positioning events
  if(posOptions.target === 'mouse') {
    // If mouse adjustment is on...
    if(posOptions.adjust.mouse) {
      // Apply a mouseleave event so we don't get problems with overlapping
      if(options.hide.event) {
        // Track if we're on the target or not
        this._bind(showTarget, ['mouseenter', 'mouseleave'], function(event) {
          this.cache.onTarget = event.type === 'mouseenter';
        });
      }

      // Update tooltip position on mousemove
      this._bind(documentTarget, 'mousemove', function(event) {
        // Update the tooltip position only if the tooltip is visible and adjustment is enabled
        if(this.rendered && this.cache.onTarget && !this.tooltip.hasClass(CLASS_DISABLED) && this.tooltip[0].offsetWidth > 0) {
          this.reposition(event);
        }
      });
    }
  }

  // Adjust positions of the tooltip on window resize if enabled
  if(posOptions.adjust.resize || viewportTarget.length) {
    this._bind( $.event.special.resize ? viewportTarget : windowTarget, 'resize', repositionMethod );
  }

  // Adjust tooltip position on scroll of the window or viewport element if present
  if(posOptions.adjust.scroll) {
    this._bind( windowTarget.add(posOptions.container), 'scroll', repositionMethod );
  }
};

// Un-assignment method
PROTOTYPE._unassignEvents = function() {
  var targets = [
    this.options.show.target[0],
    this.options.hide.target[0],
    this.rendered && this.tooltip[0],
    this.options.position.container[0],
    this.options.position.viewport[0],
    this.options.position.container.closest('html')[0], // unfocus
    window,
    document
  ];

  // Check if tooltip is rendered
  if(this.rendered) {
    this._unbind($([]).pushStack( $.grep(targets, function(i) {
      return typeof i === 'object';
    })));
  }

  // Tooltip isn't yet rendered, remove render event
  else { $(targets[0]).unbind('.'+this._id+'-create'); }
};

;// Initialization method
function init(elem, id, opts)
{
  var obj, posOptions, attr, config, title,

  // Setup element references
  docBody = $(document.body),

  // Use document body instead of document element if needed
  newTarget = elem[0] === document ? docBody : elem,

  // Grab metadata from element if plugin is present
  metadata = (elem.metadata) ? elem.metadata(opts.metadata) : NULL,

  // If metadata type if HTML5, grab 'name' from the object instead, or use the regular data object otherwise
  metadata5 = opts.metadata.type === 'html5' && metadata ? metadata[opts.metadata.name] : NULL,

  // Grab data from metadata.name (or data-qtipopts as fallback) using .data() method,
  html5 = elem.data(opts.metadata.name || 'qtipopts');

  // If we don't get an object returned attempt to parse it manualyl without parseJSON
  try { html5 = typeof html5 === 'string' ? $.parseJSON(html5) : html5; } catch(e) {}

  // Merge in and sanitize metadata
  config = $.extend(TRUE, {}, QTIP.defaults, opts,
    typeof html5 === 'object' ? sanitizeOptions(html5) : NULL,
    sanitizeOptions(metadata5 || metadata));

  // Re-grab our positioning options now we've merged our metadata and set id to passed value
  posOptions = config.position;
  config.id = id;

  // Setup missing content if none is detected
  if('boolean' === typeof config.content.text) {
    attr = elem.attr(config.content.attr);

    // Grab from supplied attribute if available
    if(config.content.attr !== FALSE && attr) { config.content.text = attr; }

    // No valid content was found, abort render
    else { return FALSE; }
  }

  // Setup target options
  if(!posOptions.container.length) { posOptions.container = docBody; }
  if(posOptions.target === FALSE) { posOptions.target = newTarget; }
  if(config.show.target === FALSE) { config.show.target = newTarget; }
  if(config.show.solo === TRUE) { config.show.solo = posOptions.container.closest('body'); }
  if(config.hide.target === FALSE) { config.hide.target = newTarget; }
  if(config.position.viewport === TRUE) { config.position.viewport = posOptions.container; }

  // Ensure we only use a single container
  posOptions.container = posOptions.container.eq(0);

  // Convert position corner values into x and y strings
  posOptions.at = new CORNER(posOptions.at, TRUE);
  posOptions.my = new CORNER(posOptions.my);

  // Destroy previous tooltip if overwrite is enabled, or skip element if not
  if(elem.data(NAMESPACE)) {
    if(config.overwrite) {
      elem.qtip('destroy');
    }
    else if(config.overwrite === FALSE) {
      return FALSE;
    }
  }

  // Add has-qtip attribute
  elem.attr(ATTR_HAS, id);

  // Remove title attribute and store it if present
  if(config.suppress && (title = elem.attr('title'))) {
    // Final attr call fixes event delegatiom and IE default tooltip showing problem
    elem.removeAttr('title').attr(oldtitle, title).attr('title', '');
  }

  // Initialize the tooltip and add API reference
  obj = new QTip(elem, config, id, !!attr);
  elem.data(NAMESPACE, obj);

  // Catch remove/removeqtip events on target element to destroy redundant tooltip
  elem.one('remove.qtip-'+id+' removeqtip.qtip-'+id, function() {
    var api; if((api = $(this).data(NAMESPACE))) { api.destroy(); }
  });

  return obj;
}

// jQuery $.fn extension method
QTIP = $.fn.qtip = function(options, notation, newValue)
{
  var command = ('' + options).toLowerCase(), // Parse command
    returned = NULL,
    args = $.makeArray(arguments).slice(1),
    event = args[args.length - 1],
    opts = this[0] ? $.data(this[0], NAMESPACE) : NULL;

  // Check for API request
  if((!arguments.length && opts) || command === 'api') {
    return opts;
  }

  // Execute API command if present
  else if('string' === typeof options)
  {
    this.each(function()
    {
      var api = $.data(this, NAMESPACE);
      if(!api) { return TRUE; }

      // Cache the event if possible
      if(event && event.timeStamp) { api.cache.event = event; }

      // Check for specific API commands
      if(notation && (command === 'option' || command === 'options')) {
        if(newValue !== undefined || $.isPlainObject(notation)) {
          api.set(notation, newValue);
        }
        else {
          returned = api.get(notation);
          return FALSE;
        }
      }

      // Execute API command
      else if(api[command]) {
        api[command].apply(api, args);
      }
    });

    return returned !== NULL ? returned : this;
  }

  // No API commands. validate provided options and setup qTips
  else if('object' === typeof options || !arguments.length)
  {
    opts = sanitizeOptions($.extend(TRUE, {}, options));

    // Bind the qTips
    return QTIP.bind.call(this, opts, event);
  }
};

// $.fn.qtip Bind method
QTIP.bind = function(opts, event)
{
  return this.each(function(i) {
    var options, targets, events, namespace, api, id;

    // Find next available ID, or use custom ID if provided
    id = $.isArray(opts.id) ? opts.id[i] : opts.id;
    id = !id || id === FALSE || id.length < 1 || QTIP.api[id] ? QTIP.nextid++ : id;

    // Setup events namespace
    namespace = '.qtip-'+id+'-create';

    // Initialize the qTip and re-grab newly sanitized options
    api = init($(this), id, opts);
    if(api === FALSE) { return TRUE; }
    else { QTIP.api[id] = api; }
    options = api.options;

    // Initialize plugins
    $.each(PLUGINS, function() {
      if(this.initialize === 'initialize') { this(api); }
    });

    // Determine hide and show targets
    targets = { show: options.show.target, hide: options.hide.target };
    events = {
      show: $.trim('' + options.show.event).replace(/ /g, namespace+' ') + namespace,
      hide: $.trim('' + options.hide.event).replace(/ /g, namespace+' ') + namespace
    };

    /*
     * Make sure hoverIntent functions properly by using mouseleave as a hide event if
     * mouseenter/mouseout is used for show.event, even if it isn't in the users options.
     */
    if(/mouse(over|enter)/i.test(events.show) && !/mouse(out|leave)/i.test(events.hide)) {
      events.hide += ' mouseleave' + namespace;
    }

    /*
     * Also make sure initial mouse targetting works correctly by caching mousemove coords
     * on show targets before the tooltip has rendered.
     *
     * Also set onTarget when triggered to keep mouse tracking working
     */
    targets.show.bind('mousemove'+namespace, function(event) {
      api._storeMouse(event);
      api.cache.onTarget = TRUE;
    });

    // Define hoverIntent function
    function hoverIntent(event) {
      function render() {
        // Cache mouse coords,render and render the tooltip
        api.render(typeof event === 'object' || options.show.ready);

        // Unbind show and hide events
        targets.show.add(targets.hide).unbind(namespace);
      }

      // Only continue if tooltip isn't disabled
      if(api.disabled) { return FALSE; }

      // Cache the event data
      api.cache.event = $.extend({}, event);
      api.cache.target = event ? $(event.target) : [undefined];

      // Start the event sequence
      if(options.show.delay > 0) {
        clearTimeout(api.timers.show);
        api.timers.show = setTimeout(render, options.show.delay);
        if(events.show !== events.hide) {
          targets.hide.bind(events.hide, function() { clearTimeout(api.timers.show); });
        }
      }
      else { render(); }
    }

    // Bind show events to target
    targets.show.bind(events.show, hoverIntent);

    // Prerendering is enabled, create tooltip now
    if(options.show.ready || options.prerender) { hoverIntent(event); }
  });
};

// Populated in render method
QTIP.api = {};
;$.each({
  /* Allow other plugins to successfully retrieve the title of an element with a qTip applied */
  attr: function(attr, val) {
    if(this.length) {
      var self = this[0],
        title = 'title',
        api = $.data(self, 'qtip');

      if(attr === title && api && 'object' === typeof api && api.options.suppress) {
        if(arguments.length < 2) {
          return $.attr(self, oldtitle);
        }

        // If qTip is rendered and title was originally used as content, update it
        if(api && api.options.content.attr === title && api.cache.attr) {
          api.set('content.text', val);
        }

        // Use the regular attr method to set, then cache the result
        return this.attr(oldtitle, val);
      }
    }

    return $.fn['attr'+replaceSuffix].apply(this, arguments);
  },

  /* Allow clone to correctly retrieve cached title attributes */
  clone: function(keepData) {
    var titles = $([]), title = 'title',

    // Clone our element using the real clone method
    elems = $.fn['clone'+replaceSuffix].apply(this, arguments);

    // Grab all elements with an oldtitle set, and change it to regular title attribute, if keepData is false
    if(!keepData) {
      elems.filter('['+oldtitle+']').attr('title', function() {
        return $.attr(this, oldtitle);
      })
      .removeAttr(oldtitle);
    }

    return elems;
  }
}, function(name, func) {
  if(!func || $.fn[name+replaceSuffix]) { return TRUE; }

  var old = $.fn[name+replaceSuffix] = $.fn[name];
  $.fn[name] = function() {
    return func.apply(this, arguments) || old.apply(this, arguments);
  };
});

/* Fire off 'removeqtip' handler in $.cleanData if jQuery UI not present (it already does similar).
 * This snippet is taken directly from jQuery UI source code found here:
 *     http://code.jquery.com/ui/jquery-ui-git.js
 */
if(!$.ui) {
  $['cleanData'+replaceSuffix] = $.cleanData;
  $.cleanData = function( elems ) {
    for(var i = 0, elem; (elem = $( elems[i] )).length && elem.attr(ATTR_ID); i++) {
      try { elem.triggerHandler('removeqtip'); }
      catch( e ) {}
    }
    $['cleanData'+replaceSuffix]( elems );
  };
}

;// qTip version
QTIP.version = '2.0.1-105';

// Base ID for all qTips
QTIP.nextid = 0;

// Inactive events array
QTIP.inactiveEvents = INACTIVE_EVENTS;

// Base z-index for all qTips
QTIP.zindex = 15000;

// Define configuration defaults
QTIP.defaults = {
  prerender: FALSE,
  id: FALSE,
  overwrite: TRUE,
  suppress: TRUE,
  content: {
    text: TRUE,
    attr: 'title',
    title: FALSE,
    button: FALSE
  },
  position: {
    my: 'top left',
    at: 'bottom right',
    target: FALSE,
    container: FALSE,
    viewport: FALSE,
    adjust: {
      x: 0, y: 0,
      mouse: TRUE,
      scroll: TRUE,
      resize: TRUE,
      method: 'flipinvert flipinvert'
    },
    effect: function(api, pos, viewport) {
      $(this).animate(pos, {
        duration: 200,
        queue: FALSE
      });
    }
  },
  show: {
    target: FALSE,
    event: 'mouseenter',
    effect: TRUE,
    delay: 90,
    solo: FALSE,
    ready: FALSE,
    autofocus: FALSE
  },
  hide: {
    target: FALSE,
    event: 'mouseleave',
    effect: TRUE,
    delay: 0,
    fixed: FALSE,
    inactive: FALSE,
    leave: 'window',
    distance: FALSE
  },
  style: {
    classes: '',
    widget: FALSE,
    width: FALSE,
    height: FALSE,
    def: TRUE
  },
  events: {
    render: NULL,
    move: NULL,
    show: NULL,
    hide: NULL,
    toggle: NULL,
    visible: NULL,
    hidden: NULL,
    focus: NULL,
    blur: NULL
  }
};

;var TIP,

// .bind()/.on() namespace
TIPNS = '.qtip-tip',

// Common CSS strings
MARGIN = 'margin',
BORDER = 'border',
COLOR = 'color',
BG_COLOR = 'background-color',
TRANSPARENT = 'transparent',
IMPORTANT = ' !important',

// Check if the browser supports <canvas/> elements
HASCANVAS = !!document.createElement('canvas').getContext,

// Invalid colour values used in parseColours()
INVALID = /rgba?\(0, 0, 0(, 0)?\)|transparent|#123456/i;

// Camel-case method, taken from jQuery source
// http://code.jquery.com/jquery-1.8.0.js
function camel(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/*
 * Modified from Modernizr's testPropsAll()
 * http://modernizr.com/downloads/modernizr-latest.js
 */
var cssProps = {}, cssPrefixes = ["Webkit", "O", "Moz", "ms"];
function vendorCss(elem, prop) {
  var ucProp = prop.charAt(0).toUpperCase() + prop.slice(1),
    props = (prop + ' ' + cssPrefixes.join(ucProp + ' ') + ucProp).split(' '),
    cur, val, i = 0;

  // If the property has already been mapped...
  if(cssProps[prop]) { return elem.css(cssProps[prop]); }

  while((cur = props[i++])) {
    if((val = elem.css(cur)) !== undefined) {
      return cssProps[prop] = cur, val;
    }
  }
}

// Parse a given elements CSS property into an int
function intCss(elem, prop) {
  return parseInt(vendorCss(elem, prop), 10);
}


// VML creation (for IE only)
if(!HASCANVAS) {
  createVML = function(tag, props, style) {
    return '<qtipvml:'+tag+' xmlns="urn:schemas-microsoft.com:vml" class="qtip-vml" '+(props||'')+
      ' style="behavior: url(#default#VML); '+(style||'')+ '" />';
  };
}



function Tip(qtip, options) {
  this._ns = 'tip';
  this.options = options;
  this.offset = options.offset;
  this.size = [ options.width, options.height ];

  // Initialize
  this.init( (this.qtip = qtip) );
}

$.extend(Tip.prototype, {
  init: function(qtip) {
    var context, tip;

    // Create tip element and prepend to the tooltip
    tip = this.element = qtip.elements.tip = $('<div />', { 'class': NAMESPACE+'-tip' }).prependTo(qtip.tooltip);

    // Create tip drawing element(s)
    if(HASCANVAS) {
      // save() as soon as we create the canvas element so FF2 doesn't bork on our first restore()!
      context = $('<canvas />').appendTo(this.element)[0].getContext('2d');

      // Setup constant parameters
      context.lineJoin = 'miter';
      context.miterLimit = 100;
      context.save();
    }
    else {
      context = createVML('shape', 'coordorigin="0,0"', 'position:absolute;');
      this.element.html(context + context);

      // Prevent mousing down on the tip since it causes problems with .live() handling in IE due to VML
      qtip._bind( $('*', tip).add(tip), ['click', 'mousedown'], function(event) { event.stopPropagation(); }, this._ns);
    }

    // Bind update events
    qtip._bind(qtip.tooltip, 'tooltipmove', this.reposition, this._ns, this);

    // Create it
    this.create();
  },

  _swapDimensions: function() {
    this.size[0] = this.options.height;
    this.size[1] = this.options.width;
  },
  _resetDimensions: function() {
    this.size[0] = this.options.width;
    this.size[1] = this.options.height;
  },

  _useTitle: function(corner) {
    var titlebar = this.qtip.elements.titlebar;
    return titlebar && (
      corner.y === TOP || (corner.y === CENTER && this.element.position().top + (size[1] / 2) + options.offset < titlebar.outerHeight(TRUE))
    );
  },

  _parseCorner: function(corner) {
    var my = this.qtip.options.position.my;

    // Detect corner and mimic properties
    if(corner === FALSE || my === FALSE) {
      corner = FALSE;
    }
    else if(corner === TRUE) {
      corner = new CORNER( my.string() );
    }
    else if(!corner.string) {
      corner = new CORNER(corner);
      corner.fixed = TRUE;
    }

    return corner;
  },

  _parseWidth: function(corner, side, use) {
    var elements = this.qtip.elements,
      prop = BORDER + camel(side) + 'Width';

    return (use ? intCss(use, prop) : (
      intCss(elements.content, prop) ||
      intCss(this._useTitle(corner) && elements.titlebar || elements.content, prop) ||
      intCss(tooltip, prop)
    )) || 0;
  },

  _parseRadius: function(corner) {
    var elements = this.qtip.elements,
      prop = BORDER + camel(corner.y) + camel(corner.x) + 'Radius';

    return BROWSER.ie < 9 ? 0 :
      intCss(this._useTitle(corner) && elements.titlebar || elements.content, prop) ||
      intCss(elements.tooltip, prop) || 0;
  },

  _invalidColour: function(elem, prop, compare) {
    var val = elem.css(prop);
    return !val || (compare && val === elem.css(compare)) || INVALID.test(val) ? FALSE : val;
  },

  _parseColours: function(corner) {
    var elements = this.qtip.elements,
      tip = this.element.css('cssText', ''),
      borderSide = BORDER + camel(corner[ corner.precedance ]) + camel(COLOR),
      colorElem = this._useTitle(corner) && elements.titlebar || elements.content,
      css = this._invalidColour, color = [];

    // Attempt to detect the background colour from various elements, left-to-right precedance
    color[0] = css(tip, BG_COLOR) || css(colorElem, BG_COLOR) || css(elements.content, BG_COLOR) ||
      css(tooltip, BG_COLOR) || tip.css(BG_COLOR);

    // Attempt to detect the correct border side colour from various elements, left-to-right precedance
    color[1] = css(tip, borderSide, COLOR) || css(colorElem, borderSide, COLOR) ||
      css(elements.content, borderSide, COLOR) || css(tooltip, borderSide, COLOR) || tooltip.css(borderSide);

    // Reset background and border colours
    $('*', tip).add(tip).css('cssText', BG_COLOR+':'+TRANSPARENT+IMPORTANT+';'+BORDER+':0'+IMPORTANT+';');

    return color;
  },

  _calculateSize: function(corner) {
    var y = corner.precedance === Y,
      width = this.options[ y ? 'height' : 'width' ],
      height = this.options[ y ? 'width' : 'height' ],
      isCenter = corner.abbrev() === 'c',
      base = width * (isCenter ? 0.5 : 1),
      pow = Math.pow,
      round = Math.round,
      bigHyp, ratio, result,

    smallHyp = Math.sqrt( pow(base, 2) + pow(height, 2) ),
    hyp = [ (this.border / base) * smallHyp, (this.border / height) * smallHyp ];

    hyp[2] = Math.sqrt( pow(hyp[0], 2) - pow(this.border, 2) );
    hyp[3] = Math.sqrt( pow(hyp[1], 2) - pow(this.border, 2) );

    bigHyp = smallHyp + hyp[2] + hyp[3] + (isCenter ? 0 : hyp[0]);
    ratio = bigHyp / smallHyp;

    result = [ round(ratio * width), round(ratio * height) ];

    return y ? result : result.reverse();
  },

  // Tip coordinates calculator
  _calculateTip: function(corner) {
    var width = this.size[0], height = this.size[1],
      width2 = Math.ceil(width / 2), height2 = Math.ceil(height / 2),

    // Define tip coordinates in terms of height and width values
    tips = {
      br: [0,0,   width,height, width,0],
      bl: [0,0,   width,0,    0,height],
      tr: [0,height,  width,0,    width,height],
      tl: [0,0,   0,height,   width,height],
      tc: [0,height,  width2,0,   width,height],
      bc: [0,0,   width,0,    width2,height],
      rc: [0,0,   width,height2,  0,height],
      lc: [width,0, width,height, 0,height2]
    };

    // Set common side shapes
    tips.lt = tips.br; tips.rt = tips.bl;
    tips.lb = tips.tr; tips.rb = tips.tl;

    return tips[ corner.abbrev() ];
  },

  create: function() {
    // Determine tip corner
    var c = this.corner = (HASCANVAS || BROWSER.ie) && this._parseCorner(this.options.corner);

    // If we have a tip corner...
    if( (this.enabled = !!this.corner && this.corner.abbrev() !== 'c') ) {
      // Cache it
      this.qtip.cache.corner = c.clone();

      // Create it
      this.update();
    }

    // Toggle tip element
    this.element.toggle(this.enabled);

    return this.corner;
  },

  update: function(corner, position) {
    if(!this.enabled) { return this; }

    var elements = this.qtip.elements,
      tip = this.element,
      inner = tip.children(),
      options = this.options,
      size = this.size,
      mimic = options.mimic,
      round = Math.round,
      color, precedance, context,
      coords, translate, newSize, border;

    // Re-determine tip if not already set
    if(!corner) { corner = this.qtip.cache.corner || this.corner; }

    // Use corner property if we detect an invalid mimic value
    if(mimic === FALSE) { mimic = corner; }

    // Otherwise inherit mimic properties from the corner object as necessary
    else {
      mimic = new CORNER(mimic);
      mimic.precedance = corner.precedance;

      if(mimic.x === 'inherit') { mimic.x = corner.x; }
      else if(mimic.y === 'inherit') { mimic.y = corner.y; }
      else if(mimic.x === mimic.y) {
        mimic[ corner.precedance ] = corner[ corner.precedance ];
      }
    }
    precedance = mimic.precedance;

    // Ensure the tip width.height are relative to the tip position
    if(corner.precedance === X) { this._swapDimensions(); }
    else { this._resetDimensions(); }

    // Update our colours
    color = this.color = this._parseColours(corner);

    // Detect border width, taking into account colours
    if(color[1] !== TRANSPARENT) {
      // Grab border width
      border = this.border = this._parseWidth(corner, corner[corner.precedance]);

      // If border width isn't zero, use border color as fill (1.0 style tips)
      if(options.border && border < 1) { color[0] = color[1]; }

      // Set border width (use detected border width if options.border is true)
      this.border = border = options.border !== TRUE ? options.border : border;
    }

    // Border colour was invalid, set border to zero
    else { this.border = border = 0; }

    // Calculate coordinates
    coords = this._calculateTip(mimic);

    // Determine tip size
    newSize = this.size = this._calculateSize(corner);
    tip.css({
      width: newSize[0],
      height: newSize[1],
      lineHeight: newSize[1]+'px'
    });

    // Calculate tip translation
    if(corner.precedance === Y) {
      translate = [
        round(mimic.x === LEFT ? border : mimic.x === RIGHT ? newSize[0] - size[0] - border : (newSize[0] - size[0]) / 2),
        round(mimic.y === TOP ? newSize[1] - size[1] : 0)
      ];
    }
    else {
      translate = [
        round(mimic.x === LEFT ? newSize[0] - size[0] : 0),
        round(mimic.y === TOP ? border : mimic.y === BOTTOM ? newSize[1] - size[1] - border : (newSize[1] - size[1]) / 2)
      ];
    }

    // Canvas drawing implementation
    if(HASCANVAS) {
      // Set the canvas size using calculated size
      inner.attr(WIDTH, newSize[0]).attr(HEIGHT, newSize[1]);

      // Grab canvas context and clear/save it
      context = inner[0].getContext('2d');
      context.restore(); context.save();
      context.clearRect(0,0,3000,3000);

      // Set properties
      context.fillStyle = color[0];
      context.strokeStyle = color[1];
      context.lineWidth = border * 2;

      // Draw the tip
      context.translate(translate[0], translate[1]);
      context.beginPath();
      context.moveTo(coords[0], coords[1]);
      context.lineTo(coords[2], coords[3]);
      context.lineTo(coords[4], coords[5]);
      context.closePath();

      // Apply fill and border
      if(border) {
        // Make sure transparent borders are supported by doing a stroke
        // of the background colour before the stroke colour
        if(tooltip.css('background-clip') === 'border-box') {
          context.strokeStyle = color[0];
          context.stroke();
        }
        context.strokeStyle = color[1];
        context.stroke();
      }
      context.fill();
    }

    // VML (IE Proprietary implementation)
    else {
      // Setup coordinates string
      coords = 'm' + coords[0] + ',' + coords[1] + ' l' + coords[2] +
        ',' + coords[3] + ' ' + coords[4] + ',' + coords[5] + ' xe';

      // Setup VML-specific offset for pixel-perfection
      translate[2] = border && /^(r|b)/i.test(corner.string()) ?
        BROWSER.ie === 8 ? 2 : 1 : 0;

      // Set initial CSS
      inner.css({
        coordsize: (size[0]+border) + ' ' + (size[1]+border),
        antialias: ''+(mimic.string().indexOf(CENTER) > -1),
        left: translate[0],
        top: translate[1],
        width: size[0] + border,
        height: size[1] + border
      })
      .each(function(i) {
        var $this = $(this);

        // Set shape specific attributes
        $this[ $this.prop ? 'prop' : 'attr' ]({
          coordsize: (size[0]+border) + ' ' + (size[1]+border),
          path: coords,
          fillcolor: color[0],
          filled: !!i,
          stroked: !i
        })
        .toggle(!!(border || i));

        // Check if border is enabled and add stroke element
        !i && $this.html( createVML(
          'stroke', 'weight="'+(border*2)+'px" color="'+color[1]+'" miterlimit="1000" joinstyle="miter"'
        ) );
      });
    }

    // Position if needed
    if(position !== FALSE) { this.calculate(corner); }
  },

  calculate: function(corner) {
    if(!this.enabled) { return FALSE; }

    var self = this,
      elements = this.qtip.elements,
      tip = this.element,
      userOffset = Math.max(0, this.options.offset),
      isWidget = this.qtip.tooltip.hasClass('ui-widget'),
      position = {  },
      precedance, size, corners;

    // Inherit corner if not provided
    corner = corner || this.corner;
    precedance = corner.precedance;

    // Determine which tip dimension to use for adjustment
    size = this._calculateSize(corner);

    // Setup corners and offset array
    corners = [ corner.x, corner.y ];
    if(precedance === X) { corners.reverse(); }

    // Calculate tip position
    $.each(corners, function(i, side) {
      var b, bc, br;

      if(side === CENTER) {
        b = precedance === Y ? LEFT : TOP;
        position[ b ] = '50%';
        position[MARGIN+'-' + b] = -Math.round(size[ precedance === Y ? 0 : 1 ] / 2) + userOffset;
      }
      else {
        b = self._parseWidth(corner, side, elements.tooltip);
        bc = self._parseWidth(corner, side, elements.content);
        br = self._parseRadius(corner);

        position[ side ] = Math.max(-self.border, i ? bc : (userOffset + (br > b ? br : -b)));
      }
    });

    // Adjust for tip size
    position[ corner[precedance] ] -= size[ precedance === X ? 0 : 1 ];

    // Set and return new position
    tip.css({ margin: '', top: '', bottom: '', left: '', right: '' }).css(position);
    return position;
  },

  reposition: function(event, api, pos, viewport) {
    if(!this.enabled) { return; }

    var cache = api.cache,
      newCorner = this.corner.clone(),
      adjust = pos.adjusted,
      method = api.options.position.adjust.method.split(' '),
      horizontal = method[0],
      vertical = method[1] || method[0],
      shift = { left: FALSE, top: FALSE, x: 0, y: 0 },
      offset, css = {}, props;

    // If our tip position isn't fixed e.g. doesn't adjust with viewport...
    if(this.corner.fixed !== TRUE) {
      // Horizontal - Shift or flip method
      if(horizontal === SHIFT && newCorner.precedance === X && adjust.left && newCorner.y !== CENTER) {
        newCorner.precedance = newCorner.precedance === X ? Y : X;
      }
      else if(horizontal !== SHIFT && adjust.left){
        newCorner.x = newCorner.x === CENTER ? (adjust.left > 0 ? LEFT : RIGHT) : (newCorner.x === LEFT ? RIGHT : LEFT);
      }

      // Vertical - Shift or flip method
      if(vertical === SHIFT && newCorner.precedance === Y && adjust.top && newCorner.x !== CENTER) {
        newCorner.precedance = newCorner.precedance === Y ? X : Y;
      }
      else if(vertical !== SHIFT && adjust.top) {
        newCorner.y = newCorner.y === CENTER ? (adjust.top > 0 ? TOP : BOTTOM) : (newCorner.y === TOP ? BOTTOM : TOP);
      }

      // Update and redraw the tip if needed (check cached details of last drawn tip)
      if(newCorner.string() !== cache.corner.string() && (cache.cornerTop !== adjust.top || cache.cornerLeft !== adjust.left)) {
        this.update(newCorner, FALSE);
      }
    }

    // Setup tip offset properties
    offset = this.calculate(newCorner, adjust);

    // Readjust offset object to make it left/top
    if(offset.right !== undefined) { offset.left = -offset.right; }
    if(offset.bottom !== undefined) { offset.top = -offset.bottom; }
    offset.user = Math.max(0, this.offset);

    // Viewport "shift" specific adjustments
    if(shift.left = (horizontal === SHIFT && !!adjust.left)) {
      if(newCorner.x === CENTER) {
        css[MARGIN+'-left'] = shift.x = offset[MARGIN+'-left'] - adjust.left;
      }
      else {
        props = offset.right !== undefined ?
          [ adjust.left, -offset.left ] : [ -adjust.left, offset.left ];

        if( (shift.x = Math.max(props[0], props[1])) > props[0] ) {
          pos.left -= adjust.left;
          shift.left = FALSE;
        }

        css[ offset.right !== undefined ? RIGHT : LEFT ] = shift.x;
      }
    }
    if(shift.top = (vertical === SHIFT && !!adjust.top)) {
      if(newCorner.y === CENTER) {
        css[MARGIN+'-top'] = shift.y = offset[MARGIN+'-top'] - adjust.top;
      }
      else {
        props = offset.bottom !== undefined ?
          [ adjust.top, -offset.top ] : [ -adjust.top, offset.top ];

        if( (shift.y = Math.max(props[0], props[1])) > props[0] ) {
          pos.top -= adjust.top;
          shift.top = FALSE;
        }

        css[ offset.bottom !== undefined ? BOTTOM : TOP ] = shift.y;
      }
    }

    /*
    * If the tip is adjusted in both dimensions, or in a
    * direction that would cause it to be anywhere but the
    * outer border, hide it!
    */
    this.element.css(css).toggle(
      !((shift.x && shift.y) || (newCorner.x === CENTER && shift.y) || (newCorner.y === CENTER && shift.x))
    );

    // Adjust position to accomodate tip dimensions
    pos.left -= offset.left.charAt ? offset.user : horizontal !== SHIFT || shift.top || !shift.left && !shift.top ? offset.left : 0;
    pos.top -= offset.top.charAt ? offset.user : vertical !== SHIFT || shift.left || !shift.left && !shift.top ? offset.top : 0;

    // Cache details
    cache.cornerLeft = adjust.left; cache.cornerTop = adjust.top;
    cache.corner = newCorner.clone();
  },

  destroy: function() {
    // Unbind events
    this.qtip._unbind(this.qtip.tooltip, this._ns);

    // Remove the tip element(s)
    if(this.qtip.elements.tip) {
      this.qtip.elements.tip.find('*')
        .remove().end().remove();
    }
  }
});

TIP = PLUGINS.tip = function(api) {
  return new Tip(api, api.options.style.tip);
};

// Initialize tip on render
TIP.initialize = 'render';

// Setup plugin sanitization options
TIP.sanitize = function(options) {
  if(options.style && 'tip' in options.style) {
    opts = options.style.tip;
    if(typeof opts !== 'object') { opts = options.style.tip = { corner: opts }; }
    if(!(/string|boolean/i).test(typeof opts.corner)) { opts.corner = TRUE; }
  }
};

// Add new option checks for the plugin
CHECKS.tip = {
  '^position.my|style.tip.(corner|mimic|border)$': function() {
    // Make sure a tip can be drawn
    this.create();

    // Reposition the tooltip
    this.qtip.reposition();
  },
  '^style.tip.(height|width)$': function(obj) {
    // Re-set dimensions and redraw the tip
    this.size = size = [ obj.width, obj.height ];
    this.update();

    // Reposition the tooltip
    this.qtip.reposition();
  },
  '^content.title|style.(classes|widget)$': function() {
    this.update();
  }
};

// Extend original qTip defaults
$.extend(TRUE, QTIP.defaults, {
  style: {
    tip: {
      corner: TRUE,
      mimic: FALSE,
      width: 6,
      height: 6,
      border: TRUE,
      offset: 0
    }
  }
});

;var MODAL, OVERLAY,
  MODALCLASS = 'qtip-modal',
  MODALSELECTOR = '.'+MODALCLASS;

OVERLAY = function()
{
  var self = this,
    focusableElems = {},
    current, onLast,
    prevState, elem;

  // Modified code from jQuery UI 1.10.0 source
  // http://code.jquery.com/ui/1.10.0/jquery-ui.js
  function focusable(element) {
    // Use the defined focusable checker when possible
    if($.expr[':'].focusable) { return $.expr[':'].focusable; }

    var isTabIndexNotNaN = !isNaN($.attr(element, 'tabindex')),
      nodeName = element.nodeName && element.nodeName.toLowerCase(),
      map, mapName, img;

    if('area' === nodeName) {
      map = element.parentNode;
      mapName = map.name;
      if(!element.href || !mapName || map.nodeName.toLowerCase() !== 'map') {
        return false;
      }
      img = $('img[usemap=#' + mapName + ']')[0];
      return !!img && img.is(':visible');
    }
    return (/input|select|textarea|button|object/.test( nodeName ) ?
        !element.disabled :
        'a' === nodeName ?
          element.href || isTabIndexNotNaN :
          isTabIndexNotNaN
      );
  }

  // Focus inputs using cached focusable elements (see update())
  function focusInputs(blurElems) {
    // Blurring body element in IE causes window.open windows to unfocus!
    if(focusableElems.length < 1 && blurElems.length) { blurElems.not('body').blur(); }

    // Focus the inputs
    else { focusableElems.first().focus(); }
  }

  // Steal focus from elements outside tooltip
  function stealFocus(event) {
    if(!elem.is(':visible')) { return; }

    var target = $(event.target),
      tooltip = current.tooltip,
      container = target.closest(SELECTOR),
      targetOnTop;

    // Determine if input container target is above this
    targetOnTop = container.length < 1 ? FALSE :
      (parseInt(container[0].style.zIndex, 10) > parseInt(tooltip[0].style.zIndex, 10));

    // If we're showing a modal, but focus has landed on an input below
    // this modal, divert focus to the first visible input in this modal
    // or if we can't find one... the tooltip itself
    if(!targetOnTop && target.closest(SELECTOR)[0] !== tooltip[0]) {
      focusInputs(target);
    }

    // Detect when we leave the last focusable element...
    onLast = event.target === focusableElems[focusableElems.length - 1];
  }

  $.extend(self, {
    init: function() {
      // Create document overlay
      elem = self.elem = $('<div />', {
        id: 'qtip-overlay',
        html: '<div></div>',
        mousedown: function() { return FALSE; }
      })
      .hide();

      // Update position on window resize or scroll
      function resize() {
        var win = $(this);
        elem.css({
          height: win.height(),
          width: win.width()
        });
      }
      $(window).bind('resize'+MODALSELECTOR, resize);
      resize(); // Fire it initially too

      // Make sure we can't focus anything outside the tooltip
      $(document.body).bind('focusin'+MODALSELECTOR, stealFocus);

      // Apply keyboard "Escape key" close handler
      $(document).bind('keydown'+MODALSELECTOR, function(event) {
        if(current && current.options.show.modal.escape && event.keyCode === 27) {
          current.hide(event);
        }
      });

      // Apply click handler for blur option
      elem.bind('click'+MODALSELECTOR, function(event) {
        if(current && current.options.show.modal.blur) {
          current.hide(event);
        }
      });

      return self;
    },

    update: function(api) {
      // Update current API reference
      current = api;

      // Update focusable elements if enabled
      if(api.options.show.modal.stealfocus !== FALSE) {
        focusableElems = api.tooltip.find('*').filter(function() {
          return focusable(this);
        });
      }
      else { focusableElems = []; }
    },

    toggle: function(api, state, duration) {
      var docBody = $(document.body),
        tooltip = api.tooltip,
        options = api.options.show.modal,
        effect = options.effect,
        type = state ? 'show': 'hide',
        visible = elem.is(':visible'),
        visibleModals = $(MODALSELECTOR).filter(':visible:not(:animated)').not(tooltip),
        zindex;

      // Set active tooltip API reference
      self.update(api);

      // If the modal can steal the focus...
      // Blur the current item and focus anything in the modal we an
      if(state && options.stealfocus !== FALSE) {
        focusInputs( $(':focus') );
      }

      // Toggle backdrop cursor style on show
      elem.toggleClass('blurs', options.blur);

      // Set position and append to body on show
      if(state) {
        elem.css({ left: 0, top: 0 })
          .appendTo(document.body);
      }

      // Prevent modal from conflicting with show.solo, and don't hide backdrop is other modals are visible
      if((elem.is(':animated') && visible === state && prevState !== FALSE) || (!state && visibleModals.length)) {
        return self;
      }

      // Stop all animations
      elem.stop(TRUE, FALSE);

      // Use custom function if provided
      if($.isFunction(effect)) {
        effect.call(elem, state);
      }

      // If no effect type is supplied, use a simple toggle
      else if(effect === FALSE) {
        elem[ type ]();
      }

      // Use basic fade function
      else {
        elem.fadeTo( parseInt(duration, 10) || 90, state ? 1 : 0, function() {
          if(!state) { elem.hide(); }
        });
      }

      // Reset position and detach from body on hide
      if(!state) {
        elem.queue(function(next) {
          elem.css({ left: '', top: '' });
          if(!$(MODALSELECTOR).length) { elem.detach(); }
          next();
        });
      }

      // Cache the state
      prevState = state;

      // If the tooltip is destroyed, set reference to null
      if(current.destroyed) { current = NULL; }

      return self;
    }
  });

  self.init();
};
OVERLAY = new OVERLAY();

function Modal(api, options) {
  this.options = options;
  this._ns = '-modal';

  this.init( (this.qtip = api) );
}

$.extend(Modal.prototype, {
  init: function(qtip) {
    var tooltip = qtip.tooltip;

    // If modal is disabled... return
    if(!this.options.on) { return this; }

    // Set overlay reference
    qtip.elements.overlay = OVERLAY.elem;

    // Add unique attribute so we can grab modal tooltips easily via a SELECTOR, and set z-index
    tooltip.addClass(MODALCLASS).css('z-index', PLUGINS.modal.zindex + $(MODALSELECTOR).length);

    // Apply our show/hide/focus modal events
    qtip._bind(tooltip, ['tooltipshow', 'tooltiphide'], function(event, api, duration) {
      var oEvent = event.originalEvent;

      // Make sure mouseout doesn't trigger a hide when showing the modal and mousing onto backdrop
      if(event.target === tooltip[0]) {
        if(oEvent && event.type === 'tooltiphide' && /mouse(leave|enter)/.test(oEvent.type) && $(oEvent.relatedTarget).closest(overlay[0]).length) {
          try { event.preventDefault(); } catch(e) {}
        }
        else if(!oEvent || (oEvent && !oEvent.solo)) {
          this.toggle(event, event.type === 'tooltipshow', duration);
        }
      }
    }, this._ns, this);

    // Adjust modal z-index on tooltip focus
    qtip._bind(tooltip, 'tooltipfocus', function(event, api) {
      // If focus was cancelled before it reached us, don't do anything
      if(event.isDefaultPrevented() || event.target !== tooltip[0]) { return; }

      var qtips = $(MODALSELECTOR),

      // Keep the modal's lower than other, regular qtips
      newIndex = PLUGINS.modal.zindex + qtips.length,
      curIndex = parseInt(tooltip[0].style.zIndex, 10);

      // Set overlay z-index
      OVERLAY.elem[0].style.zIndex = newIndex - 1;

      // Reduce modal z-index's and keep them properly ordered
      qtips.each(function() {
        if(this.style.zIndex > curIndex) {
          this.style.zIndex -= 1;
        }
      });

      // Fire blur event for focused tooltip
      qtips.filter('.' + CLASS_FOCUS).qtip('blur', event.originalEvent);

      // Set the new z-index
      tooltip.addClass(CLASS_FOCUS)[0].style.zIndex = newIndex;

      // Set current
      OVERLAY.update(api);

      // Prevent default handling
      try { event.preventDefault(); } catch(e) {}
    }, this._ns, this);

    // Focus any other visible modals when this one hides
    qtip._bind(tooltip, 'tooltiphide', function(event) {
      if(event.target === tooltip[0]) {
        $(MODALSELECTOR).filter(':visible').not(tooltip).last().qtip('focus', event);
      }
    }, this._ns, this);
  },

  toggle: function(event, state, duration) {
    // Make sure default event hasn't been prevented
    if(event && event.isDefaultPrevented()) { return this; }

    // Toggle it
    OVERLAY.toggle(this.qtip, !!state, duration);
  },

  destroy: function() {
    // Remove modal class
    this.qtip.tooltip.removeClass(MODALCLASS);

    // Remove bound events
    this.qtip._unbind(this.qtip.tooltip, this._ns);

    // Delete element reference
    OVERLAY.toggle(this.qtip, FALSE);
    delete this.qtip.elements.overlay;
  }
});


MODAL = PLUGINS.modal = function(api) {
  return new Modal(api, api.options.show.modal);
};

// Setup sanitiztion rules
MODAL.sanitize = function(opts) {
  if(opts.show) {
    if(typeof opts.show.modal !== 'object') { opts.show.modal = { on: !!opts.show.modal }; }
    else if(typeof opts.show.modal.on === 'undefined') { opts.show.modal.on = TRUE; }
  }
};

// Base z-index for all modal tooltips (use qTip core z-index as a base)
MODAL.zindex = QTIP.zindex - 200;

// Plugin needs to be initialized on render
MODAL.initialize = 'render';

// Setup option set checks
CHECKS.modal = {
  '^show.modal.(on|blur)$': function() {
    // Initialise
    this.destroy();
    this.init();

    // Show the modal if not visible already and tooltip is visible
    this.qtip.elems.overlay.toggle(
      this.qtip.tooltip[0].offsetWidth > 0
    );
  }
};

// Extend original api defaults
$.extend(TRUE, QTIP.defaults, {
  show: {
    modal: {
      on: FALSE,
      effect: TRUE,
      blur: TRUE,
      stealfocus: TRUE,
      escape: TRUE
    }
  }
});
;PLUGINS.viewport = function(api, position, posOptions, targetWidth, targetHeight, elemWidth, elemHeight)
{
  var target = posOptions.target,
    tooltip = api.elements.tooltip,
    my = posOptions.my,
    at = posOptions.at,
    adjust = posOptions.adjust,
    method = adjust.method.split(' '),
    methodX = method[0],
    methodY = method[1] || method[0],
    viewport = posOptions.viewport,
    container = posOptions.container,
    cache = api.cache,
    tip = api.plugins.tip,
    adjusted = { left: 0, top: 0 },
    fixed, newMy, newClass;

  // If viewport is not a jQuery element, or it's the window/document or no adjustment method is used... return
  if(!viewport.jquery || target[0] === window || target[0] === document.body || adjust.method === 'none') {
    return adjusted;
  }

  // Cache our viewport details
  fixed = tooltip.css('position') === 'fixed';
  viewport = {
    elem: viewport,
    width: viewport[0] === window ? viewport.width() : viewport.outerWidth(FALSE),
    height: viewport[0] === window ? viewport.height() : viewport.outerHeight(FALSE),
    scrollleft: fixed ? 0 : viewport.scrollLeft(),
    scrolltop: fixed ? 0 : viewport.scrollTop(),
    offset: viewport.offset() || { left: 0, top: 0 }
  };
  container = {
    elem: container,
    scrollLeft: container.scrollLeft(),
    scrollTop: container.scrollTop(),
    offset: container.offset() || { left: 0, top: 0 }
  };

  // Generic calculation method
  function calculate(side, otherSide, type, adjust, side1, side2, lengthName, targetLength, elemLength) {
    var initialPos = position[side1],
      mySide = my[side], atSide = at[side],
      isShift = type === SHIFT,
      viewportScroll = -container.offset[side1] + viewport.offset[side1] + viewport['scroll'+side1],
      myLength = mySide === side1 ? elemLength : mySide === side2 ? -elemLength : -elemLength / 2,
      atLength = atSide === side1 ? targetLength : atSide === side2 ? -targetLength : -targetLength / 2,
      tipLength = tip && tip.size ? tip.size[lengthName] || 0 : 0,
      tipAdjust = tip && tip.corner && tip.corner.precedance === side && !isShift ? tipLength : 0,
      overflow1 = viewportScroll - initialPos + tipAdjust,
      overflow2 = initialPos + elemLength - viewport[lengthName] - viewportScroll + tipAdjust,
      offset = myLength - (my.precedance === side || mySide === my[otherSide] ? atLength : 0) - (atSide === CENTER ? targetLength / 2 : 0);

    // shift
    if(isShift) {
      tipAdjust = tip && tip.corner && tip.corner.precedance === otherSide ? tipLength : 0;
      offset = (mySide === side1 ? 1 : -1) * myLength - tipAdjust;

      // Adjust position but keep it within viewport dimensions
      position[side1] += overflow1 > 0 ? overflow1 : overflow2 > 0 ? -overflow2 : 0;
      position[side1] = Math.max(
        -container.offset[side1] + viewport.offset[side1] + (tipAdjust && tip.corner[side] === CENTER ? tip.offset : 0),
        initialPos - offset,
        Math.min(
          Math.max(-container.offset[side1] + viewport.offset[side1] + viewport[lengthName], initialPos + offset),
          position[side1]
        )
      );
    }

    // flip/flipinvert
    else {
      // Update adjustment amount depending on if using flipinvert or flip
      adjust *= (type === FLIPINVERT ? 2 : 0);

      // Check for overflow on the left/top
      if(overflow1 > 0 && (mySide !== side1 || overflow2 > 0)) {
        position[side1] -= offset + adjust;
        newMy.invert(side, side1);
      }

      // Check for overflow on the bottom/right
      else if(overflow2 > 0 && (mySide !== side2 || overflow1 > 0)  ) {
        position[side1] -= (mySide === CENTER ? -offset : offset) + adjust;
        newMy.invert(side, side2);
      }

      // Make sure we haven't made things worse with the adjustment and reset if so
      if(position[side1] < viewportScroll && -position[side1] > overflow2) {
        position[side1] = initialPos; newMy = my.clone();
      }
    }

    return position[side1] - initialPos;
  }

  // Set newMy if using flip or flipinvert methods
  if(methodX !== 'shift' || methodY !== 'shift') { newMy = my.clone(); }

  // Adjust position based onviewport and adjustment options
  adjusted = {
    left: methodX !== 'none' ? calculate( X, Y, methodX, adjust.x, LEFT, RIGHT, WIDTH, targetWidth, elemWidth ) : 0,
    top: methodY !== 'none' ? calculate( Y, X, methodY, adjust.y, TOP, BOTTOM, HEIGHT, targetHeight, elemHeight ) : 0
  };

  // Set tooltip position class if it's changed
  if(newMy && cache.lastClass !== (newClass = NAMESPACE + '-pos-' + newMy.abbrev())) {
    tooltip.removeClass(api.cache.lastClass).addClass( (api.cache.lastClass = newClass) );
  }

  return adjusted;
};;PLUGINS.polys = {
  // POLY area coordinate calculator
  //  Special thanks to Ed Cradock for helping out with this.
  //  Uses a binary search algorithm to find suitable coordinates.
  polygon: function(baseCoords, corner) {
    var result = {
      width: 0, height: 0,
      position: {
        top: 1e10, right: 0,
        bottom: 0, left: 1e10
      },
      adjustable: FALSE
    },
    i = 0, next,
    coords = [],
    compareX = 1, compareY = 1,
    realX = 0, realY = 0,
    newWidth, newHeight;

    // First pass, sanitize coords and determine outer edges
    i = baseCoords.length; while(i--) {
      next = [ parseInt(baseCoords[--i], 10), parseInt(baseCoords[i+1], 10) ];

      if(next[0] > result.position.right){ result.position.right = next[0]; }
      if(next[0] < result.position.left){ result.position.left = next[0]; }
      if(next[1] > result.position.bottom){ result.position.bottom = next[1]; }
      if(next[1] < result.position.top){ result.position.top = next[1]; }

      coords.push(next);
    }

    // Calculate height and width from outer edges
    newWidth = result.width = Math.abs(result.position.right - result.position.left);
    newHeight = result.height = Math.abs(result.position.bottom - result.position.top);

    // If it's the center corner...
    if(corner.abbrev() === 'c') {
      result.position = {
        left: result.position.left + (result.width / 2),
        top: result.position.top + (result.height / 2)
      };
    }
    else {
      // Second pass, use a binary search algorithm to locate most suitable coordinate
      while(newWidth > 0 && newHeight > 0 && compareX > 0 && compareY > 0)
      {
        newWidth = Math.floor(newWidth / 2);
        newHeight = Math.floor(newHeight / 2);

        if(corner.x === LEFT){ compareX = newWidth; }
        else if(corner.x === RIGHT){ compareX = result.width - newWidth; }
        else{ compareX += Math.floor(newWidth / 2); }

        if(corner.y === TOP){ compareY = newHeight; }
        else if(corner.y === BOTTOM){ compareY = result.height - newHeight; }
        else{ compareY += Math.floor(newHeight / 2); }

        i = coords.length; while(i--)
        {
          if(coords.length < 2){ break; }

          realX = coords[i][0] - result.position.left;
          realY = coords[i][1] - result.position.top;

          if((corner.x === LEFT && realX >= compareX) ||
          (corner.x === RIGHT && realX <= compareX) ||
          (corner.x === CENTER && (realX < compareX || realX > (result.width - compareX))) ||
          (corner.y === TOP && realY >= compareY) ||
          (corner.y === BOTTOM && realY <= compareY) ||
          (corner.y === CENTER && (realY < compareY || realY > (result.height - compareY)))) {
            coords.splice(i, 1);
          }
        }
      }
      result.position = { left: coords[0][0], top: coords[0][1] };
    }

    return result;
  },

  rect: function(ax, ay, bx, by, corner) {
    return {
      width: Math.abs(bx - ax),
      height: Math.abs(by - ay),
      position: {
        left: Math.min(ax, bx),
        top: Math.min(ay, by)
      }
    };
  },

  _angles: {
    tc: 3 / 2, tr: 7 / 4, tl: 5 / 4,
    bc: 1 / 2, br: 1 / 4, bl: 3 / 4,
    rc: 2, lc: 1, c: 0
  },
  ellipse: function(cx, cy, rx, ry, corner) {
    var c = PLUGINS.polys._angles[ corner.abbrev() ],
      rxc = rx * Math.cos( c * Math.PI ),
      rys = ry * Math.sin( c * Math.PI );

    return {
      width: (rx * 2) - Math.abs(rxc),
      height: (ry * 2) - Math.abs(rys),
      position: {
        left: cx + rxc,
        top: cy + rys
      },
      adjustable: FALSE
    };
  },
  circle: function(cx, cy, r, corner) {
    return PLUGINS.polys.ellipse(cx, cy, r, r, corner);
  }
};;PLUGINS.svg = function(api, svg, corner, adjustMethod)
{
  var doc = $(document),
    elem = svg[0],
    result = FALSE,
    name, box, position, dimensions;

  // Ascend the parentNode chain until we find an element with getBBox()
  while(!elem.getBBox) { elem = elem.parentNode; }
  if(!elem.getBBox || !elem.parentNode) { return FALSE; }

  // Determine which shape calculation to use
  switch(elem.nodeName) {
    case 'rect':
      position = PLUGINS.svg.toPixel(elem, elem.x.baseVal.value, elem.y.baseVal.value);
      dimensions = PLUGINS.svg.toPixel(elem,
        elem.x.baseVal.value + elem.width.baseVal.value,
        elem.y.baseVal.value + elem.height.baseVal.value
      );

      result = PLUGINS.polys.rect(
        position[0], position[1],
        dimensions[0], dimensions[1],
        corner
      );
    break;

    case 'ellipse':
    case 'circle':
      position = PLUGINS.svg.toPixel(elem,
        elem.cx.baseVal.value,
        elem.cy.baseVal.value
      );

      result = PLUGINS.polys.ellipse(
        position[0], position[1],
        (elem.rx || elem.r).baseVal.value,
        (elem.ry || elem.r).baseVal.value,
        corner
      );
    break;

    case 'line':
    case 'polygon':
    case 'polyline':
      points = elem.points || [
        { x: elem.x1.baseVal.value, y: elem.y1.baseVal.value },
        { x: elem.x2.baseVal.value, y: elem.y2.baseVal.value }
      ];

      for(result = [], i = -1, len = points.numberOfItems || points.length; ++i < len;) {
        next = points.getItem ? points.getItem(i) : points[i];
        result.push.apply(result, PLUGINS.svg.toPixel(elem, next.x, next.y));
      }

      result = PLUGINS.polys.polygon(result, corner);
    break;

    // Invalid shape
    default: return FALSE;
  }

  // Adjust by scroll offset
  result.position.left += doc.scrollLeft();
  result.position.top += doc.scrollTop();

  return result;
};

PLUGINS.svg.toPixel = function(elem, x, y) {
  var mtx = elem.getScreenCTM(),
    root = elem.farthestViewportElement || elem,
    result, point;

  // Create SVG point
  if(!root.createSVGPoint) { return FALSE; }
  point = root.createSVGPoint();

  point.x = x; point.y = y;
  result = point.matrixTransform(mtx);
  return [ result.x, result.y ];
};;PLUGINS.imagemap = function(api, area, corner, adjustMethod)
{
  if(!area.jquery) { area = $(area); }

  var shape = area.attr('shape').toLowerCase().replace('poly', 'polygon'),
    image = $('img[usemap="#'+area.parent('map').attr('name')+'"]'),
    coordsString = area.attr('coords'),
    coordsArray = coordsString.split(','),
    imageOffset, coords, i, next;

  // If we can't find the image using the map...
  if(!image.length) { return FALSE; }

  // Pass coordinates string if polygon
  if(shape === 'polygon') {
    result = PLUGINS.polys.polygon(coordsArray, corner);
  }

  // Otherwise parse the coordinates and pass them as arguments
  else if(PLUGINS.polys[shape]) {
    for(i = -1, len = coordsArray.length, coords = []; ++i < len;) {
      coords.push( parseInt(coordsArray[i], 10) );
    }

    result = PLUGINS.polys[shape].apply(
      this, coords.concat(corner)
    );
  }

  // If no shapre calculation method was found, return false
  else { return FALSE; }

  // Make sure we account for padding and borders on the image
  imageOffset = image.offset();
  imageOffset.left += Math.ceil((image.outerWidth(FALSE) - image.width()) / 2);
  imageOffset.top += Math.ceil((image.outerHeight(FALSE) - image.height()) / 2);

  // Add image position to offset coordinates
  result.position.left += imageOffset.left;
  result.position.top += imageOffset.top;

  return result;
};;var IE6,

/*
 * BGIFrame adaption (http://plugins.jquery.com/project/bgiframe)
 * Special thanks to Brandon Aaron
 */
BGIFRAME = '<iframe class="qtip-bgiframe" frameborder="0" tabindex="-1" src="javascript:\'\';" ' +
  ' style="display:block; position:absolute; z-index:-1; filter:alpha(opacity=0); ' +
    '-ms-filter:"progid:DXImageTransform.Microsoft.Alpha(Opacity=0)";"></iframe>';

function Ie6(api, qtip) {
  this._ns = 'ie6';
  this.init( (this.qtip = api) );
}

$.extend(Ie6.prototype, {
  _scroll : function() {
    var overlay = this.qtip.elements.overlay;
    overlay && (overlay[0].style.top = $(window).scrollTop() + 'px');
  },

  init: function(qtip) {
    var tooltip = qtip.tooltip,
      scroll;

    // Create the BGIFrame element if needed
    if($('select, object').length < 1) {
      this.bgiframe = qtip.elements.bgiframe = $(BGIFRAME).appendTo(tooltip);

      // Update BGIFrame on tooltip move
      qtip._bind(tooltip, 'tooltipmove', this.adjustBGIFrame, this._ns, this);
    }

    // redraw() container for width/height calculations
    this.redrawContainer = $('<div/>', { id: NAMESPACE+'-rcontainer' })
      .appendTo(document.body);

    // Fixup modal plugin if present too
    if( qtip.elements.overlay && qtip.elements.overlay.addClass('qtipmodal-ie6fix') ) {
      qtip._bind(window, ['scroll', 'resize'], this._scroll, this._ns, this);
      qtip._bind(tooltip, ['tooltipshow'], this._scroll, this._ns, this);
    }

    // Set dimensions
    this.redraw();
  },

  adjustBGIFrame: function() {
    var tooltip = this.qtip.tooltip,
      dimensions = {
        height: tooltip.outerHeight(FALSE),
        width: tooltip.outerWidth(FALSE)
      },
      plugin = this.qtip.plugins.tip,
      tip = this.qtip.elements.tip,
      tipAdjust, offset;

    // Adjust border offset
    offset = parseInt(tooltip.css('borderLeftWidth'), 10) || 0;
    offset = { left: -offset, top: -offset };

    // Adjust for tips plugin
    if(plugin && tip) {
      tipAdjust = (plugin.corner.precedance === 'x') ? [WIDTH, LEFT] : [HEIGHT, TOP];
      offset[ tipAdjust[1] ] -= tip[ tipAdjust[0] ]();
    }

    // Update bgiframe
    this.bgiframe.css(offset).css(dimensions);
  },

  // Max/min width simulator function
  redraw: function() {
    if(this.qtip.rendered < 1 || this.drawing) { return self; }

    var tooltip = this.qtip.tooltip,
      style = this.qtip.options.style,
      container = this.qtip.options.position.container,
      perc, width, max, min;

    // Set drawing flag
    this.qtip.drawing = 1;

    // If tooltip has a set height/width, just set it... like a boss!
    if(style.height) { tooltip.css(HEIGHT, style.height); }
    if(style.width) { tooltip.css(WIDTH, style.width); }

    // Simulate max/min width if not set width present...
    else {
      // Reset width and add fluid class
      tooltip.css(WIDTH, '').appendTo(this.redrawContainer);

      // Grab our tooltip width (add 1 if odd so we don't get wrapping problems.. huzzah!)
      width = tooltip.width();
      if(width % 2 < 1) { width += 1; }

      // Grab our max/min properties
      max = tooltip.css('maxWidth') || '';
      min = tooltip.css('minWidth') || '';

      // Parse into proper pixel values
      perc = (max + min).indexOf('%') > -1 ? container.width() / 100 : 0;
      max = ((max.indexOf('%') > -1 ? perc : 1) * parseInt(max, 10)) || width;
      min = ((min.indexOf('%') > -1 ? perc : 1) * parseInt(min, 10)) || 0;

      // Determine new dimension size based on max/min/current values
      width = max + min ? Math.min(Math.max(width, min), max) : width;

      // Set the newly calculated width and remvoe fluid class
      tooltip.css(WIDTH, Math.round(width)).appendTo(container);
    }

    // Set drawing flag
    this.drawing = 0;

    return self;
  },

  destroy: function() {
    // Remove iframe
    this.bgiframe && this.bgiframe.remove();

    // Remove bound events
    this.qtip._unbind([window, this.qtip.tooltip], this._ns);
  }
});

IE6 = PLUGINS.ie6 = function(api) {
  // Proceed only if the browser is IE6
  return BROWSER.ie === 6 ? new Ie6(api) : FALSE;
};

IE6.initialize = 'render';

CHECKS.ie6 = {
  '^content|style$': function() {
    this.redraw();
  }
};;}));
}( window, document ));




/*!
 * jQuery imagesLoaded plugin v2.1.1
 * http://github.com/desandro/imagesloaded
 *
 * MIT License. by Paul Irish et al.
 */

/*jshint curly: true, eqeqeq: true, noempty: true, strict: true, undef: true, browser: true */
/*global jQuery: false */

;(function($, undefined) {
'use strict';

// blank image data-uri bypasses webkit log warning (thx doug jones)
var BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

$.fn.imagesLoaded = function( callback ) {
  var $this = this,
    deferred = $.isFunction($.Deferred) ? $.Deferred() : 0,
    hasNotify = $.isFunction(deferred.notify),
    $images = $this.find('img').add( $this.filter('img') ),
    loaded = [],
    proper = [],
    broken = [];

  // Register deferred callbacks
  if ($.isPlainObject(callback)) {
    $.each(callback, function (key, value) {
      if (key === 'callback') {
        callback = value;
      } else if (deferred) {
        deferred[key](value);
      }
    });
  }

  function doneLoading() {
    var $proper = $(proper),
      $broken = $(broken);

    if ( deferred ) {
      if ( broken.length ) {
        deferred.reject( $images, $proper, $broken );
      } else {
        deferred.resolve( $images );
      }
    }

    if ( $.isFunction( callback ) ) {
      callback.call( $this, $images, $proper, $broken );
    }
  }

  function imgLoadedHandler( event ) {
    imgLoaded( event.target, event.type === 'error' );
  }

  function imgLoaded( img, isBroken ) {
    // don't proceed if BLANK image, or image is already loaded
    if ( img.src === BLANK || $.inArray( img, loaded ) !== -1 ) {
      return;
    }

    // store element in loaded images array
    loaded.push( img );

    // keep track of broken and properly loaded images
    if ( isBroken ) {
      broken.push( img );
    } else {
      proper.push( img );
    }

    // cache image and its state for future calls
    $.data( img, 'imagesLoaded', { isBroken: isBroken, src: img.src } );

    // trigger deferred progress method if present
    if ( hasNotify ) {
      deferred.notifyWith( $(img), [ isBroken, $images, $(proper), $(broken) ] );
    }

    // call doneLoading and clean listeners if all images are loaded
    if ( $images.length === loaded.length ) {
      setTimeout( doneLoading );
      $images.unbind( '.imagesLoaded', imgLoadedHandler );
    }
  }

  // if no images, trigger immediately
  if ( !$images.length ) {
    doneLoading();
  } else {
    $images.bind( 'load.imagesLoaded error.imagesLoaded', imgLoadedHandler )
    .each( function( i, el ) {
      var src = el.src;

      // find out if this image has been already checked for status
      // if it was, and src has not changed, call imgLoaded on it
      var cached = $.data( el, 'imagesLoaded' );
      if ( cached && cached.src === src ) {
        imgLoaded( el, cached.isBroken );
        return;
      }

      // if complete is true and browser supports natural sizes, try
      // to check for image status manually
      if ( el.complete && el.naturalWidth !== undefined ) {
        imgLoaded( el, el.naturalWidth === 0 || el.naturalHeight === 0 );
        return;
      }

      // cached images don't fire load sometimes, so we reset src, but only when
      // dealing with IE, or image is complete (loaded) and failed manual check
      // webkit hack from http://groups.google.com/group/jquery-dev/browse_thread/thread/eee6ab7b2da50e1f
      if ( el.readyState || el.complete ) {
        el.src = BLANK;
        el.src = src;
      }
    });
  }

  return deferred ? deferred.promise( $this ) : $this;
};

})(jQuery);
/*
 * jQuery slugIt plug-in 1.0
 *
 * Copyright (c) 2010 Diego Kuperman
 *
 * Inspired by perl module Text::Unidecode and Django urlfy.js
 *
 * Licensed under the BSD license:
 *      http://www.opensource.org/licenses/bsd-license.php
 */

jQuery.fn.slugIt = function(options) {
    var defaults = {
        events: 'keypress keyup',
        output: '#slug',
        map:    false,
        before: false,
        after: false
    };

    var opts  = jQuery.extend(defaults, options);

    var chars = latin_map();
        chars = jQuery.extend(chars, greek_map());
        chars = jQuery.extend(chars, turkish_map());
        chars = jQuery.extend(chars, russian_map());
        chars = jQuery.extend(chars, ukranian_map());
        chars = jQuery.extend(chars, czech_map());
        chars = jQuery.extend(chars, latvian_map());
        chars = jQuery.extend(chars, polish_map());
        chars = jQuery.extend(chars, symbols_map());
        chars = jQuery.extend(chars, currency_map());

    if ( opts.map ) {
        chars = jQuery.extend(chars, opts.map);
    }

    jQuery(this).bind(defaults.events, function() {
        var text = jQuery(this).val();
        if ( opts.before ) text = opts.before(text);
        text = jQuery.trim(text.toString());

        var slug = new String();
        for (var i = 0; i < text.length; i++) {
            if ( chars[text.charAt(i)] ) { slug += chars[text.charAt(i)] }
            else                         { slug += text.charAt(i) }
        }

        slug = slug.replace(/[^-\w\s$\*\(\)\'\!\_]/g, '-');  // remove unneeded chars
        slug = slug.replace(/^\s+|\s+$/g, ''); // trim leading/trailing spaces
        slug = slug.replace(/[-\s]+/g, '-');   // convert spaces
        slug = slug.replace(/-$/, '');         // remove trailing separator
        slug = slug.toLowerCase();

        if ( opts.after ) slug = opts.after(slug);

        if ( typeof opts.output == "function" ) {
          opts.output(slug)
        } else {
          jQuery(opts.output).val(slug);         // input or textarea
          jQuery(opts.output).html(slug);        // other dom elements
        }

        return this;
    });

    function latin_map() {
        return {
            'À': 'A', 'Á': 'A', 'Â': 'A', 'Ã': 'A', 'Ä': 'A', 'Å': 'A', 'Æ': 'AE', 'Ç':
            'C', 'È': 'E', 'É': 'E', 'Ê': 'E', 'Ë': 'E', 'Ì': 'I', 'Í': 'I', 'Î': 'I',
            'Ï': 'I', 'Ð': 'D', 'Ñ': 'N', 'Ò': 'O', 'Ó': 'O', 'Ô': 'O', 'Õ': 'O', 'Ö':
            'O', 'Ő': 'O', 'Ø': 'O', 'Ù': 'U', 'Ú': 'U', 'Û': 'U', 'Ü': 'U', 'Ű': 'U',
            'Ý': 'Y', 'Þ': 'TH', 'ß': 'ss', 'à':'a', 'á':'a', 'â': 'a', 'ã': 'a', 'ä':
            'a', 'å': 'a', 'æ': 'ae', 'ç': 'c', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
            'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ð': 'd', 'ñ': 'n', 'ò': 'o', 'ó':
            'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ő': 'o', 'ø': 'o', 'ù': 'u', 'ú': 'u',
            'û': 'u', 'ü': 'u', 'ű': 'u', 'ý': 'y', 'þ': 'th', 'ÿ': 'y'
        };
    }

    function greek_map() {
        return {
            'α':'a', 'β':'b', 'γ':'g', 'δ':'d', 'ε':'e', 'ζ':'z', 'η':'h', 'θ':'8',
            'ι':'i', 'κ':'k', 'λ':'l', 'μ':'m', 'ν':'n', 'ξ':'3', 'ο':'o', 'π':'p',
            'ρ':'r', 'σ':'s', 'τ':'t', 'υ':'y', 'φ':'f', 'χ':'x', 'ψ':'ps', 'ω':'w',
            'ά':'a', 'έ':'e', 'ί':'i', 'ό':'o', 'ύ':'y', 'ή':'h', 'ώ':'w', 'ς':'s',
            'ϊ':'i', 'ΰ':'y', 'ϋ':'y', 'ΐ':'i',
            'Α':'A', 'Β':'B', 'Γ':'G', 'Δ':'D', 'Ε':'E', 'Ζ':'Z', 'Η':'H', 'Θ':'8',
            'Ι':'I', 'Κ':'K', 'Λ':'L', 'Μ':'M', 'Ν':'N', 'Ξ':'3', 'Ο':'O', 'Π':'P',
            'Ρ':'R', 'Σ':'S', 'Τ':'T', 'Υ':'Y', 'Φ':'F', 'Χ':'X', 'Ψ':'PS', 'Ω':'W',
            'Ά':'A', 'Έ':'E', 'Ί':'I', 'Ό':'O', 'Ύ':'Y', 'Ή':'H', 'Ώ':'W', 'Ϊ':'I',
            'Ϋ':'Y'
        };
    }

    function turkish_map() {
        return {
            'ş':'s', 'Ş':'S', 'ı':'i', 'İ':'I', 'ç':'c', 'Ç':'C', 'ü':'u', 'Ü':'U',
            'ö':'o', 'Ö':'O', 'ğ':'g', 'Ğ':'G'
        };
    }

    function russian_map() {
        return {
            'а':'a', 'б':'b', 'в':'v', 'г':'g', 'д':'d', 'е':'e', 'ё':'yo', 'ж':'zh',
            'з':'z', 'и':'i', 'й':'j', 'к':'k', 'л':'l', 'м':'m', 'н':'n', 'о':'o',
            'п':'p', 'р':'r', 'с':'s', 'т':'t', 'у':'u', 'ф':'f', 'х':'h', 'ц':'c',
            'ч':'ch', 'ш':'sh', 'щ':'sh', 'ъ':'', 'ы':'y', 'ь':'', 'э':'e', 'ю':'yu',
            'я':'ya',
            'А':'A', 'Б':'B', 'В':'V', 'Г':'G', 'Д':'D', 'Е':'E', 'Ё':'Yo', 'Ж':'Zh',
            'З':'Z', 'И':'I', 'Й':'J', 'К':'K', 'Л':'L', 'М':'M', 'Н':'N', 'О':'O',
            'П':'P', 'Р':'R', 'С':'S', 'Т':'T', 'У':'U', 'Ф':'F', 'Х':'H', 'Ц':'C',
            'Ч':'Ch', 'Ш':'Sh', 'Щ':'Sh', 'Ъ':'', 'Ы':'Y', 'Ь':'', 'Э':'E', 'Ю':'Yu',
            'Я':'Ya'
        };
    }

    function ukranian_map() {
        return {
            'Є':'Ye', 'І':'I', 'Ї':'Yi', 'Ґ':'G', 'є':'ye', 'і':'i', 'ї':'yi', 'ґ':'g'
        };
    }

    function czech_map() {
        return {
            'č':'c', 'ď':'d', 'ě':'e', 'ň': 'n', 'ř':'r', 'š':'s', 'ť':'t', 'ů':'u',
            'ž':'z', 'Č':'C', 'Ď':'D', 'Ě':'E', 'Ň': 'N', 'Ř':'R', 'Š':'S', 'Ť':'T',
            'Ů':'U', 'Ž':'Z'
        };
    }

    function polish_map() {
        return {
            'ą':'a', 'ć':'c', 'ę':'e', 'ł':'l', 'ń':'n', 'ó':'o', 'ś':'s', 'ź':'z',
            'ż':'z', 'Ą':'A', 'Ć':'C', 'Ę':'e', 'Ł':'L', 'Ń':'N', 'Ó':'o', 'Ś':'S',
            'Ź':'Z', 'Ż':'Z'
        };
    }

    function latvian_map() {
        return {
            'ā':'a', 'č':'c', 'ē':'e', 'ģ':'g', 'ī':'i', 'ķ':'k', 'ļ':'l', 'ņ':'n',
            'š':'s', 'ū':'u', 'ž':'z', 'Ā':'A', 'Č':'C', 'Ē':'E', 'Ģ':'G', 'Ī':'i',
            'Ķ':'k', 'Ļ':'L', 'Ņ':'N', 'Š':'S', 'Ū':'u', 'Ž':'Z'
        };
    }

    function currency_map() {
        return {
            '€': 'euro', '₢': 'cruzeiro', '₣': 'french franc', '£': 'pound',
            '₤': 'lira', '₥': 'mill', '₦': 'naira', '₧': 'peseta', '₨': 'rupee',
            '₩': 'won', '₪': 'new shequel', '₫': 'dong', '₭': 'kip', '₮': 'tugrik',
            '₯': 'drachma', '₰': 'penny', '₱': 'peso', '₲': 'guarani', '₳': 'austral',
            '₴': 'hryvnia', '₵': 'cedi', '¢': 'cent', '¥': 'yen', '元': 'yuan',
            '円': 'yen', '﷼': 'rial', '₠': 'ecu', '¤': 'currency', '฿': 'baht'
        };
    }

    function symbols_map() {
        return {
            '©':'(c)', 'œ': 'oe', 'Œ': 'OE', '∑': 'sum', '®': '(r)', '†': '+',
            '“': '"', '”': '"', '‘': "'", '’': "'", '∂': 'd', 'ƒ': 'f', '™': 'tm',
            '℠': 'sm', '…': '...', '˚': 'o', 'º': 'o', 'ª': 'a', '•': '*',
            '∆': 'delta', '∞': 'infinity', '♥': 'love', '&': 'and'
        };
    }

  return this;
}

;(function(){

/**
 * Require the module at `name`.
 *
 * @param {String} name
 * @return {Object} exports
 * @api public
 */

function require(name) {
  var module = require.modules[name];
  if (!module) throw new Error('failed to require "' + name + '"');

  if (!('exports' in module) && typeof module.definition === 'function') {
    module.client = module.component = true;
    module.definition.call(this, module.exports = {}, module);
    delete module.definition;
  }

  return module.exports;
}

/**
 * Registered modules.
 */

require.modules = {};

/**
 * Register module at `name` with callback `definition`.
 *
 * @param {String} name
 * @param {Function} definition
 * @api private
 */

require.register = function (name, definition) {
  require.modules[name] = {
    definition: definition
  };
};

/**
 * Define a module's exports immediately with `exports`.
 *
 * @param {String} name
 * @param {Generic} exports
 * @api private
 */

require.define = function (name, exports) {
  require.modules[name] = {
    exports: exports
  };
};
require.register("component~emitter@1.1.2", function (exports, module) {

/**
 * Expose `Emitter`.
 */

module.exports = Emitter;

/**
 * Initialize a new `Emitter`.
 *
 * @api public
 */

function Emitter(obj) {
  if (obj) return mixin(obj);
};

/**
 * Mixin the emitter properties.
 *
 * @param {Object} obj
 * @return {Object}
 * @api private
 */

function mixin(obj) {
  for (var key in Emitter.prototype) {
    obj[key] = Emitter.prototype[key];
  }
  return obj;
}

/**
 * Listen on the given `event` with `fn`.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.on =
Emitter.prototype.addEventListener = function(event, fn){
  this._callbacks = this._callbacks || {};
  (this._callbacks[event] = this._callbacks[event] || [])
    .push(fn);
  return this;
};

/**
 * Adds an `event` listener that will be invoked a single
 * time then automatically removed.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.once = function(event, fn){
  var self = this;
  this._callbacks = this._callbacks || {};

  function on() {
    self.off(event, on);
    fn.apply(this, arguments);
  }

  on.fn = fn;
  this.on(event, on);
  return this;
};

/**
 * Remove the given callback for `event` or all
 * registered callbacks.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.off =
Emitter.prototype.removeListener =
Emitter.prototype.removeAllListeners =
Emitter.prototype.removeEventListener = function(event, fn){
  this._callbacks = this._callbacks || {};

  // all
  if (0 == arguments.length) {
    this._callbacks = {};
    return this;
  }

  // specific event
  var callbacks = this._callbacks[event];
  if (!callbacks) return this;

  // remove all handlers
  if (1 == arguments.length) {
    delete this._callbacks[event];
    return this;
  }

  // remove specific handler
  var cb;
  for (var i = 0; i < callbacks.length; i++) {
    cb = callbacks[i];
    if (cb === fn || cb.fn === fn) {
      callbacks.splice(i, 1);
      break;
    }
  }
  return this;
};

/**
 * Emit `event` with the given args.
 *
 * @param {String} event
 * @param {Mixed} ...
 * @return {Emitter}
 */

Emitter.prototype.emit = function(event){
  this._callbacks = this._callbacks || {};
  var args = [].slice.call(arguments, 1)
    , callbacks = this._callbacks[event];

  if (callbacks) {
    callbacks = callbacks.slice(0);
    for (var i = 0, len = callbacks.length; i < len; ++i) {
      callbacks[i].apply(this, args);
    }
  }

  return this;
};

/**
 * Return array of callbacks for `event`.
 *
 * @param {String} event
 * @return {Array}
 * @api public
 */

Emitter.prototype.listeners = function(event){
  this._callbacks = this._callbacks || {};
  return this._callbacks[event] || [];
};

/**
 * Check if this emitter has `event` handlers.
 *
 * @param {String} event
 * @return {Boolean}
 * @api public
 */

Emitter.prototype.hasListeners = function(event){
  return !! this.listeners(event).length;
};

});

require.register("dropzone", function (exports, module) {


/**
 * Exposing dropzone
 */
module.exports = require("dropzone/lib/dropzone.js");

});

require.register("dropzone/lib/dropzone.js", function (exports, module) {

/*
 *
 * More info at [www.dropzonejs.com](http://www.dropzonejs.com)
 *
 * Copyright (c) 2012, Matias Meno
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 */

(function() {
  var Dropzone, Em, camelize, contentLoaded, detectVerticalSquash, drawImageIOSFix, noop, without,
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    __slice = [].slice;

  Em = typeof Emitter !== "undefined" && Emitter !== null ? Emitter : require("component~emitter@1.1.2");

  noop = function() {};

  Dropzone = (function(_super) {
    var extend;

    __extends(Dropzone, _super);


    /*
    This is a list of all available events you can register on a dropzone object.
    
    You can register an event handler like this:
    
        dropzone.on("dragEnter", function() { });
     */

    Dropzone.prototype.events = ["drop", "dragstart", "dragend", "dragenter", "dragover", "dragleave", "addedfile", "removedfile", "thumbnail", "error", "errormultiple", "processing", "processingmultiple", "uploadprogress", "totaluploadprogress", "sending", "sendingmultiple", "success", "successmultiple", "canceled", "canceledmultiple", "complete", "completemultiple", "reset", "maxfilesexceeded", "maxfilesreached"];

    Dropzone.prototype.defaultOptions = {
      url: null,
      method: "post",
      withCredentials: false,
      parallelUploads: 2,
      uploadMultiple: false,
      maxFilesize: 256,
      paramName: "file",
      createImageThumbnails: true,
      maxThumbnailFilesize: 10,
      thumbnailWidth: 100,
      thumbnailHeight: 100,
      maxFiles: null,
      params: {},
      clickable: true,
      ignoreHiddenFiles: true,
      acceptedFiles: null,
      acceptedMimeTypes: null,
      autoProcessQueue: true,
      autoQueue: true,
      addRemoveLinks: false,
      previewsContainer: null,
      dictDefaultMessage: "Drop files here to upload",
      dictFallbackMessage: "Your browser does not support drag'n'drop file uploads.",
      dictFallbackText: "Please use the fallback form below to upload your files like in the olden days.",
      dictFileTooBig: "File is too big ({{filesize}}MiB). Max filesize: {{maxFilesize}}MiB.",
      dictInvalidFileType: "You can't upload files of this type.",
      dictResponseError: "Server responded with {{statusCode}} code.",
      dictCancelUpload: "Cancel upload",
      dictCancelUploadConfirmation: "Are you sure you want to cancel this upload?",
      dictRemoveFile: "Remove file",
      dictRemoveFileConfirmation: null,
      dictMaxFilesExceeded: "You can not upload any more files.",
      accept: function(file, done) {
        return done();
      },
      init: function() {
        return noop;
      },
      forceFallback: false,
      fallback: function() {
        var child, messageElement, span, _i, _len, _ref;
        this.element.className = "" + this.element.className + " dz-browser-not-supported";
        _ref = this.element.getElementsByTagName("div");
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          child = _ref[_i];
          if (/(^| )dz-message($| )/.test(child.className)) {
            messageElement = child;
            child.className = "dz-message";
            continue;
          }
        }
        if (!messageElement) {
          messageElement = Dropzone.createElement("<div class=\"dz-message\"><span></span></div>");
          this.element.appendChild(messageElement);
        }
        span = messageElement.getElementsByTagName("span")[0];
        if (span) {
          span.textContent = this.options.dictFallbackMessage;
        }
        return this.element.appendChild(this.getFallbackForm());
      },
      resize: function(file) {
        var info, srcRatio, trgRatio;
        info = {
          srcX: 0,
          srcY: 0,
          srcWidth: file.width,
          srcHeight: file.height
        };
        srcRatio = file.width / file.height;
        info.optWidth = this.options.thumbnailWidth;
        info.optHeight = this.options.thumbnailHeight;
        if ((info.optWidth == null) && (info.optHeight == null)) {
          info.optWidth = info.srcWidth;
          info.optHeight = info.srcHeight;
        } else if (info.optWidth == null) {
          info.optWidth = srcRatio * info.optHeight;
        } else if (info.optHeight == null) {
          info.optHeight = (1 / srcRatio) * info.optWidth;
        }
        trgRatio = info.optWidth / info.optHeight;
        if (file.height < info.optHeight || file.width < info.optWidth) {
          info.trgHeight = info.srcHeight;
          info.trgWidth = info.srcWidth;
        } else {
          if (srcRatio > trgRatio) {
            info.srcHeight = file.height;
            info.srcWidth = info.srcHeight * trgRatio;
          } else {
            info.srcWidth = file.width;
            info.srcHeight = info.srcWidth / trgRatio;
          }
        }
        info.srcX = (file.width - info.srcWidth) / 2;
        info.srcY = (file.height - info.srcHeight) / 2;
        return info;
      },

      /*
      Those functions register themselves to the events on init and handle all
      the user interface specific stuff. Overwriting them won't break the upload
      but can break the way it's displayed.
      You can overwrite them if you don't like the default behavior. If you just
      want to add an additional event handler, register it on the dropzone object
      and don't overwrite those options.
       */
      drop: function(e) {
        return this.element.classList.remove("dz-drag-hover");
      },
      dragstart: noop,
      dragend: function(e) {
        return this.element.classList.remove("dz-drag-hover");
      },
      dragenter: function(e) {
        return this.element.classList.add("dz-drag-hover");
      },
      dragover: function(e) {
        return this.element.classList.add("dz-drag-hover");
      },
      dragleave: function(e) {
        return this.element.classList.remove("dz-drag-hover");
      },
      paste: noop,
      reset: function() {
        return this.element.classList.remove("dz-started");
      },
      addedfile: function(file) {
        var node, removeFileEvent, removeLink, _i, _j, _k, _len, _len1, _len2, _ref, _ref1, _ref2, _results;
        if (this.element === this.previewsContainer) {
          this.element.classList.add("dz-started");
        }
        if (this.previewsContainer) {
          file.previewElement = Dropzone.createElement(this.options.previewTemplate.trim());
          file.previewTemplate = file.previewElement;
          this.previewsContainer.appendChild(file.previewElement);
          _ref = file.previewElement.querySelectorAll("[data-dz-name]");
          for (_i = 0, _len = _ref.length; _i < _len; _i++) {
            node = _ref[_i];
            node.textContent = file.name;
          }
          _ref1 = file.previewElement.querySelectorAll("[data-dz-size]");
          for (_j = 0, _len1 = _ref1.length; _j < _len1; _j++) {
            node = _ref1[_j];
            node.innerHTML = this.filesize(file.size);
          }
          if (this.options.addRemoveLinks) {
            file._removeLink = Dropzone.createElement("<a class=\"dz-remove\" href=\"javascript:undefined;\" data-dz-remove>" + this.options.dictRemoveFile + "</a>");
            file.previewElement.appendChild(file._removeLink);
          }
          removeFileEvent = (function(_this) {
            return function(e) {
              e.preventDefault();
              e.stopPropagation();
              if (file.status === Dropzone.UPLOADING) {
                return Dropzone.confirm(_this.options.dictCancelUploadConfirmation, function() {
                  return _this.removeFile(file);
                });
              } else {
                if (_this.options.dictRemoveFileConfirmation) {
                  return Dropzone.confirm(_this.options.dictRemoveFileConfirmation, function() {
                    return _this.removeFile(file);
                  });
                } else {
                  return _this.removeFile(file);
                }
              }
            };
          })(this);
          _ref2 = file.previewElement.querySelectorAll("[data-dz-remove]");
          _results = [];
          for (_k = 0, _len2 = _ref2.length; _k < _len2; _k++) {
            removeLink = _ref2[_k];
            _results.push(removeLink.addEventListener("click", removeFileEvent));
          }
          return _results;
        }
      },
      removedfile: function(file) {
        var _ref;
        if (file.previewElement) {
          if ((_ref = file.previewElement) != null) {
            _ref.parentNode.removeChild(file.previewElement);
          }
        }
        return this._updateMaxFilesReachedClass();
      },
      thumbnail: function(file, dataUrl) {
        var thumbnailElement, _i, _len, _ref, _results;
        if (file.previewElement) {
          file.previewElement.classList.remove("dz-file-preview");
          file.previewElement.classList.add("dz-image-preview");
          _ref = file.previewElement.querySelectorAll("[data-dz-thumbnail]");
          _results = [];
          for (_i = 0, _len = _ref.length; _i < _len; _i++) {
            thumbnailElement = _ref[_i];
            thumbnailElement.alt = file.name;
            _results.push(thumbnailElement.src = dataUrl);
          }
          return _results;
        }
      },
      error: function(file, message) {
        var node, _i, _len, _ref, _results;
        if (file.previewElement) {
          file.previewElement.classList.add("dz-error");
          if (typeof message !== "String" && message.error) {
            message = message.error;
          }
          _ref = file.previewElement.querySelectorAll("[data-dz-errormessage]");
          _results = [];
          for (_i = 0, _len = _ref.length; _i < _len; _i++) {
            node = _ref[_i];
            _results.push(node.textContent = message);
          }
          return _results;
        }
      },
      errormultiple: noop,
      processing: function(file) {
        if (file.previewElement) {
          file.previewElement.classList.add("dz-processing");
          if (file._removeLink) {
            return file._removeLink.textContent = this.options.dictCancelUpload;
          }
        }
      },
      processingmultiple: noop,
      uploadprogress: function(file, progress, bytesSent) {
        var node, _i, _len, _ref, _results;
        if (file.previewElement) {
          _ref = file.previewElement.querySelectorAll("[data-dz-uploadprogress]");
          _results = [];
          for (_i = 0, _len = _ref.length; _i < _len; _i++) {
            node = _ref[_i];
            _results.push(node.style.width = "" + progress + "%");
          }
          return _results;
        }
      },
      totaluploadprogress: noop,
      sending: noop,
      sendingmultiple: noop,
      success: function(file) {
        if (file.previewElement) {
          return file.previewElement.classList.add("dz-success");
        }
      },
      successmultiple: noop,
      canceled: function(file) {
        return this.emit("error", file, "Upload canceled.");
      },
      canceledmultiple: noop,
      complete: function(file) {
        if (file._removeLink) {
          return file._removeLink.textContent = this.options.dictRemoveFile;
        }
      },
      completemultiple: noop,
      maxfilesexceeded: noop,
      maxfilesreached: noop,
      previewTemplate: "<div class=\"dz-preview dz-file-preview\">\n  <div class=\"dz-details\">\n    <div class=\"dz-filename\"><span data-dz-name></span></div>\n    <div class=\"dz-size\" data-dz-size></div>\n    <img data-dz-thumbnail />\n  </div>\n  <div class=\"dz-progress\"><span class=\"dz-upload\" data-dz-uploadprogress></span></div>\n  <div class=\"dz-success-mark\"><span>✔</span></div>\n  <div class=\"dz-error-mark\"><span>✘</span></div>\n  <div class=\"dz-error-message\"><span data-dz-errormessage></span></div>\n</div>"
    };

    extend = function() {
      var key, object, objects, target, val, _i, _len;
      target = arguments[0], objects = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      for (_i = 0, _len = objects.length; _i < _len; _i++) {
        object = objects[_i];
        for (key in object) {
          val = object[key];
          target[key] = val;
        }
      }
      return target;
    };

    function Dropzone(element, options) {
      var elementOptions, fallback, _ref;
      this.element = element;
      this.version = Dropzone.version;
      this.defaultOptions.previewTemplate = this.defaultOptions.previewTemplate.replace(/\n*/g, "");
      this.clickableElements = [];
      this.listeners = [];
      this.files = [];
      if (typeof this.element === "string") {
        this.element = document.querySelector(this.element);
      }
      if (!(this.element && (this.element.nodeType != null))) {
        throw new Error("Invalid dropzone element.");
      }
      if (this.element.dropzone) {
        throw new Error("Dropzone already attached.");
      }
      Dropzone.instances.push(this);
      this.element.dropzone = this;
      elementOptions = (_ref = Dropzone.optionsForElement(this.element)) != null ? _ref : {};
      this.options = extend({}, this.defaultOptions, elementOptions, options != null ? options : {});
      if (this.options.forceFallback || !Dropzone.isBrowserSupported()) {
        return this.options.fallback.call(this);
      }
      if (this.options.url == null) {
        this.options.url = this.element.getAttribute("action");
      }
      if (!this.options.url) {
        throw new Error("No URL provided.");
      }
      if (this.options.acceptedFiles && this.options.acceptedMimeTypes) {
        throw new Error("You can't provide both 'acceptedFiles' and 'acceptedMimeTypes'. 'acceptedMimeTypes' is deprecated.");
      }
      if (this.options.acceptedMimeTypes) {
        this.options.acceptedFiles = this.options.acceptedMimeTypes;
        delete this.options.acceptedMimeTypes;
      }
      this.options.method = this.options.method.toUpperCase();
      if ((fallback = this.getExistingFallback()) && fallback.parentNode) {
        fallback.parentNode.removeChild(fallback);
      }
      if (this.options.previewsContainer !== false) {
        if (this.options.previewsContainer) {
          this.previewsContainer = Dropzone.getElement(this.options.previewsContainer, "previewsContainer");
        } else {
          this.previewsContainer = this.element;
        }
      }
      if (this.options.clickable) {
        if (this.options.clickable === true) {
          this.clickableElements = [this.element];
        } else {
          this.clickableElements = Dropzone.getElements(this.options.clickable, "clickable");
        }
      }
      this.init();
    }

    Dropzone.prototype.getAcceptedFiles = function() {
      var file, _i, _len, _ref, _results;
      _ref = this.files;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        file = _ref[_i];
        if (file.accepted) {
          _results.push(file);
        }
      }
      return _results;
    };

    Dropzone.prototype.getRejectedFiles = function() {
      var file, _i, _len, _ref, _results;
      _ref = this.files;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        file = _ref[_i];
        if (!file.accepted) {
          _results.push(file);
        }
      }
      return _results;
    };

    Dropzone.prototype.getFilesWithStatus = function(status) {
      var file, _i, _len, _ref, _results;
      _ref = this.files;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        file = _ref[_i];
        if (file.status === status) {
          _results.push(file);
        }
      }
      return _results;
    };

    Dropzone.prototype.getQueuedFiles = function() {
      return this.getFilesWithStatus(Dropzone.QUEUED);
    };

    Dropzone.prototype.getUploadingFiles = function() {
      return this.getFilesWithStatus(Dropzone.UPLOADING);
    };

    Dropzone.prototype.getActiveFiles = function() {
      var file, _i, _len, _ref, _results;
      _ref = this.files;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        file = _ref[_i];
        if (file.status === Dropzone.UPLOADING || file.status === Dropzone.QUEUED) {
          _results.push(file);
        }
      }
      return _results;
    };

    Dropzone.prototype.init = function() {
      var eventName, noPropagation, setupHiddenFileInput, _i, _len, _ref, _ref1;
      if (this.element.tagName === "form") {
        this.element.setAttribute("enctype", "multipart/form-data");
      }
      if (this.element.classList.contains("dropzone") && !this.element.querySelector(".dz-message")) {
        this.element.appendChild(Dropzone.createElement("<div class=\"dz-default dz-message\"><span>" + this.options.dictDefaultMessage + "</span></div>"));
      }
      if (this.clickableElements.length) {
        setupHiddenFileInput = (function(_this) {
          return function() {
            if (_this.hiddenFileInput) {
              document.body.removeChild(_this.hiddenFileInput);
            }
            _this.hiddenFileInput = document.createElement("input");
            _this.hiddenFileInput.setAttribute("type", "file");
            if ((_this.options.maxFiles == null) || _this.options.maxFiles > 1) {
              _this.hiddenFileInput.setAttribute("multiple", "multiple");
            }
            _this.hiddenFileInput.className = "dz-hidden-input";
            if (_this.options.acceptedFiles != null) {
              _this.hiddenFileInput.setAttribute("accept", _this.options.acceptedFiles);
            }
            _this.hiddenFileInput.style.visibility = "hidden";
            _this.hiddenFileInput.style.position = "absolute";
            _this.hiddenFileInput.style.top = "0";
            _this.hiddenFileInput.style.left = "0";
            _this.hiddenFileInput.style.height = "0";
            _this.hiddenFileInput.style.width = "0";
            document.body.appendChild(_this.hiddenFileInput);
            return _this.hiddenFileInput.addEventListener("change", function() {
              var file, files, _i, _len;
              files = _this.hiddenFileInput.files;
              if (files.length) {
                for (_i = 0, _len = files.length; _i < _len; _i++) {
                  file = files[_i];
                  _this.addFile(file);
                }
              }
              return setupHiddenFileInput();
            });
          };
        })(this);
        setupHiddenFileInput();
      }
      this.URL = (_ref = window.URL) != null ? _ref : window.webkitURL;
      _ref1 = this.events;
      for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
        eventName = _ref1[_i];
        this.on(eventName, this.options[eventName]);
      }
      this.on("uploadprogress", (function(_this) {
        return function() {
          return _this.updateTotalUploadProgress();
        };
      })(this));
      this.on("removedfile", (function(_this) {
        return function() {
          return _this.updateTotalUploadProgress();
        };
      })(this));
      this.on("canceled", (function(_this) {
        return function(file) {
          return _this.emit("complete", file);
        };
      })(this));
      this.on("complete", (function(_this) {
        return function(file) {
          if (_this.getUploadingFiles().length === 0 && _this.getQueuedFiles().length === 0) {
            return setTimeout((function() {
              return _this.emit("queuecomplete");
            }), 0);
          }
        };
      })(this));
      noPropagation = function(e) {
        e.stopPropagation();
        if (e.preventDefault) {
          return e.preventDefault();
        } else {
          return e.returnValue = false;
        }
      };
      this.listeners = [
        {
          element: this.element,
          events: {
            "dragstart": (function(_this) {
              return function(e) {
                return _this.emit("dragstart", e);
              };
            })(this),
            "dragenter": (function(_this) {
              return function(e) {
                noPropagation(e);
                return _this.emit("dragenter", e);
              };
            })(this),
            "dragover": (function(_this) {
              return function(e) {
                var efct;
                try {
                  efct = e.dataTransfer.effectAllowed;
                } catch (_error) {}
                e.dataTransfer.dropEffect = 'move' === efct || 'linkMove' === efct ? 'move' : 'copy';
                noPropagation(e);
                return _this.emit("dragover", e);
              };
            })(this),
            "dragleave": (function(_this) {
              return function(e) {
                return _this.emit("dragleave", e);
              };
            })(this),
            "drop": (function(_this) {
              return function(e) {
                noPropagation(e);
                return _this.drop(e);
              };
            })(this),
            "dragend": (function(_this) {
              return function(e) {
                return _this.emit("dragend", e);
              };
            })(this)
          }
        }
      ];
      this.clickableElements.forEach((function(_this) {
        return function(clickableElement) {
          return _this.listeners.push({
            element: clickableElement,
            events: {
              "click": function(evt) {
                if ((clickableElement !== _this.element) || (evt.target === _this.element || Dropzone.elementInside(evt.target, _this.element.querySelector(".dz-message")))) {
                  return _this.hiddenFileInput.click();
                }
              }
            }
          });
        };
      })(this));
      this.enable();
      return this.options.init.call(this);
    };

    Dropzone.prototype.destroy = function() {
      var _ref;
      this.disable();
      this.removeAllFiles(true);
      if ((_ref = this.hiddenFileInput) != null ? _ref.parentNode : void 0) {
        this.hiddenFileInput.parentNode.removeChild(this.hiddenFileInput);
        this.hiddenFileInput = null;
      }
      delete this.element.dropzone;
      return Dropzone.instances.splice(Dropzone.instances.indexOf(this), 1);
    };

    Dropzone.prototype.updateTotalUploadProgress = function() {
      var activeFiles, file, totalBytes, totalBytesSent, totalUploadProgress, _i, _len, _ref;
      totalBytesSent = 0;
      totalBytes = 0;
      activeFiles = this.getActiveFiles();
      if (activeFiles.length) {
        _ref = this.getActiveFiles();
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          file = _ref[_i];
          totalBytesSent += file.upload.bytesSent;
          totalBytes += file.upload.total;
        }
        totalUploadProgress = 100 * totalBytesSent / totalBytes;
      } else {
        totalUploadProgress = 100;
      }
      return this.emit("totaluploadprogress", totalUploadProgress, totalBytes, totalBytesSent);
    };

    Dropzone.prototype._getParamName = function(n) {
      if (typeof this.options.paramName === "function") {
        return this.options.paramName(n);
      } else {
        return "" + this.options.paramName + (this.options.uploadMultiple ? "[" + n + "]" : "");
      }
    };

    Dropzone.prototype.getFallbackForm = function() {
      var existingFallback, fields, fieldsString, form;
      if (existingFallback = this.getExistingFallback()) {
        return existingFallback;
      }
      fieldsString = "<div class=\"dz-fallback\">";
      if (this.options.dictFallbackText) {
        fieldsString += "<p>" + this.options.dictFallbackText + "</p>";
      }
      fieldsString += "<input type=\"file\" name=\"" + (this._getParamName(0)) + "\" " + (this.options.uploadMultiple ? 'multiple="multiple"' : void 0) + " /><input type=\"submit\" value=\"Upload!\"></div>";
      fields = Dropzone.createElement(fieldsString);
      if (this.element.tagName !== "FORM") {
        form = Dropzone.createElement("<form action=\"" + this.options.url + "\" enctype=\"multipart/form-data\" method=\"" + this.options.method + "\"></form>");
        form.appendChild(fields);
      } else {
        this.element.setAttribute("enctype", "multipart/form-data");
        this.element.setAttribute("method", this.options.method);
      }
      return form != null ? form : fields;
    };

    Dropzone.prototype.getExistingFallback = function() {
      var fallback, getFallback, tagName, _i, _len, _ref;
      getFallback = function(elements) {
        var el, _i, _len;
        for (_i = 0, _len = elements.length; _i < _len; _i++) {
          el = elements[_i];
          if (/(^| )fallback($| )/.test(el.className)) {
            return el;
          }
        }
      };
      _ref = ["div", "form"];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        tagName = _ref[_i];
        if (fallback = getFallback(this.element.getElementsByTagName(tagName))) {
          return fallback;
        }
      }
    };

    Dropzone.prototype.setupEventListeners = function() {
      var elementListeners, event, listener, _i, _len, _ref, _results;
      _ref = this.listeners;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        elementListeners = _ref[_i];
        _results.push((function() {
          var _ref1, _results1;
          _ref1 = elementListeners.events;
          _results1 = [];
          for (event in _ref1) {
            listener = _ref1[event];
            _results1.push(elementListeners.element.addEventListener(event, listener, false));
          }
          return _results1;
        })());
      }
      return _results;
    };

    Dropzone.prototype.removeEventListeners = function() {
      var elementListeners, event, listener, _i, _len, _ref, _results;
      _ref = this.listeners;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        elementListeners = _ref[_i];
        _results.push((function() {
          var _ref1, _results1;
          _ref1 = elementListeners.events;
          _results1 = [];
          for (event in _ref1) {
            listener = _ref1[event];
            _results1.push(elementListeners.element.removeEventListener(event, listener, false));
          }
          return _results1;
        })());
      }
      return _results;
    };

    Dropzone.prototype.disable = function() {
      var file, _i, _len, _ref, _results;
      this.clickableElements.forEach(function(element) {
        return element.classList.remove("dz-clickable");
      });
      this.removeEventListeners();
      _ref = this.files;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        file = _ref[_i];
        _results.push(this.cancelUpload(file));
      }
      return _results;
    };

    Dropzone.prototype.enable = function() {
      this.clickableElements.forEach(function(element) {
        return element.classList.add("dz-clickable");
      });
      return this.setupEventListeners();
    };

    Dropzone.prototype.filesize = function(size) {
      var string;
      if (size >= 1024 * 1024 * 1024 * 1024 / 10) {
        size = size / (1024 * 1024 * 1024 * 1024 / 10);
        string = "TiB";
      } else if (size >= 1024 * 1024 * 1024 / 10) {
        size = size / (1024 * 1024 * 1024 / 10);
        string = "GiB";
      } else if (size >= 1024 * 1024 / 10) {
        size = size / (1024 * 1024 / 10);
        string = "MiB";
      } else if (size >= 1024 / 10) {
        size = size / (1024 / 10);
        string = "KiB";
      } else {
        size = size * 10;
        string = "b";
      }
      return "<strong>" + (Math.round(size) / 10) + "</strong> " + string;
    };

    Dropzone.prototype._updateMaxFilesReachedClass = function() {
      if ((this.options.maxFiles != null) && this.getAcceptedFiles().length >= this.options.maxFiles) {
        if (this.getAcceptedFiles().length === this.options.maxFiles) {
          this.emit('maxfilesreached', this.files);
        }
        return this.element.classList.add("dz-max-files-reached");
      } else {
        return this.element.classList.remove("dz-max-files-reached");
      }
    };

    Dropzone.prototype.drop = function(e) {
      var files, items;
      if (!e.dataTransfer) {
        return;
      }
      this.emit("drop", e);
      files = e.dataTransfer.files;
      if (files.length) {
        items = e.dataTransfer.items;
        if (items && items.length && (items[0].webkitGetAsEntry != null)) {
          this._addFilesFromItems(items);
        } else {
          this.handleFiles(files);
        }
      }
    };

    Dropzone.prototype.paste = function(e) {
      var items, _ref;
      if ((e != null ? (_ref = e.clipboardData) != null ? _ref.items : void 0 : void 0) == null) {
        return;
      }
      this.emit("paste", e);
      items = e.clipboardData.items;
      if (items.length) {
        return this._addFilesFromItems(items);
      }
    };

    Dropzone.prototype.handleFiles = function(files) {
      var file, _i, _len, _results;
      _results = [];
      for (_i = 0, _len = files.length; _i < _len; _i++) {
        file = files[_i];
        _results.push(this.addFile(file));
      }
      return _results;
    };

    Dropzone.prototype._addFilesFromItems = function(items) {
      var entry, item, _i, _len, _results;
      _results = [];
      for (_i = 0, _len = items.length; _i < _len; _i++) {
        item = items[_i];
        if ((item.webkitGetAsEntry != null) && (entry = item.webkitGetAsEntry())) {
          if (entry.isFile) {
            _results.push(this.addFile(item.getAsFile()));
          } else if (entry.isDirectory) {
            _results.push(this._addFilesFromDirectory(entry, entry.name));
          } else {
            _results.push(void 0);
          }
        } else if (item.getAsFile != null) {
          if ((item.kind == null) || item.kind === "file") {
            _results.push(this.addFile(item.getAsFile()));
          } else {
            _results.push(void 0);
          }
        } else {
          _results.push(void 0);
        }
      }
      return _results;
    };

    Dropzone.prototype._addFilesFromDirectory = function(directory, path) {
      var dirReader, entriesReader;
      dirReader = directory.createReader();
      entriesReader = (function(_this) {
        return function(entries) {
          var entry, _i, _len;
          for (_i = 0, _len = entries.length; _i < _len; _i++) {
            entry = entries[_i];
            if (entry.isFile) {
              entry.file(function(file) {
                if (_this.options.ignoreHiddenFiles && file.name.substring(0, 1) === '.') {
                  return;
                }
                file.fullPath = "" + path + "/" + file.name;
                return _this.addFile(file);
              });
            } else if (entry.isDirectory) {
              _this._addFilesFromDirectory(entry, "" + path + "/" + entry.name);
            }
          }
        };
      })(this);
      return dirReader.readEntries(entriesReader, function(error) {
        return typeof console !== "undefined" && console !== null ? typeof console.log === "function" ? console.log(error) : void 0 : void 0;
      });
    };

    Dropzone.prototype.accept = function(file, done) {
      if (file.size > this.options.maxFilesize * 1024 * 1024) {
        return done(this.options.dictFileTooBig.replace("{{filesize}}", Math.round(file.size / 1024 / 10.24) / 100).replace("{{maxFilesize}}", this.options.maxFilesize));
      } else if (!Dropzone.isValidFile(file, this.options.acceptedFiles)) {
        return done(this.options.dictInvalidFileType);
      } else if ((this.options.maxFiles != null) && this.getAcceptedFiles().length >= this.options.maxFiles) {
        done(this.options.dictMaxFilesExceeded.replace("{{maxFiles}}", this.options.maxFiles));
        return this.emit("maxfilesexceeded", file);
      } else {
        return this.options.accept.call(this, file, done);
      }
    };

    Dropzone.prototype.addFile = function(file) {
      file.upload = {
        progress: 0,
        total: file.size,
        bytesSent: 0
      };
      this.files.push(file);
      file.status = Dropzone.ADDED;
      this.emit("addedfile", file);
      this._enqueueThumbnail(file);
      return this.accept(file, (function(_this) {
        return function(error) {
          if (error) {
            file.accepted = false;
            _this._errorProcessing([file], error);
          } else {
            file.accepted = true;
            if (_this.options.autoQueue) {
              _this.enqueueFile(file);
            }
          }
          return _this._updateMaxFilesReachedClass();
        };
      })(this));
    };

    Dropzone.prototype.enqueueFiles = function(files) {
      var file, _i, _len;
      for (_i = 0, _len = files.length; _i < _len; _i++) {
        file = files[_i];
        this.enqueueFile(file);
      }
      return null;
    };

    Dropzone.prototype.enqueueFile = function(file) {
      if (file.status === Dropzone.ADDED && file.accepted === true) {
        file.status = Dropzone.QUEUED;
        if (this.options.autoProcessQueue) {
          return setTimeout(((function(_this) {
            return function() {
              return _this.processQueue();
            };
          })(this)), 0);
        }
      } else {
        throw new Error("This file can't be queued because it has already been processed or was rejected.");
      }
    };

    Dropzone.prototype._thumbnailQueue = [];

    Dropzone.prototype._processingThumbnail = false;

    Dropzone.prototype._enqueueThumbnail = function(file) {
      if (this.options.createImageThumbnails && file.type.match(/image.*/) && file.size <= this.options.maxThumbnailFilesize * 1024 * 1024) {
        this._thumbnailQueue.push(file);
        return setTimeout(((function(_this) {
          return function() {
            return _this._processThumbnailQueue();
          };
        })(this)), 0);
      }
    };

    Dropzone.prototype._processThumbnailQueue = function() {
      if (this._processingThumbnail || this._thumbnailQueue.length === 0) {
        return;
      }
      this._processingThumbnail = true;
      return this.createThumbnail(this._thumbnailQueue.shift(), (function(_this) {
        return function() {
          _this._processingThumbnail = false;
          return _this._processThumbnailQueue();
        };
      })(this));
    };

    Dropzone.prototype.removeFile = function(file) {
      if (file.status === Dropzone.UPLOADING) {
        this.cancelUpload(file);
      }
      this.files = without(this.files, file);
      this.emit("removedfile", file);
      if (this.files.length === 0) {
        return this.emit("reset");
      }
    };

    Dropzone.prototype.removeAllFiles = function(cancelIfNecessary) {
      var file, _i, _len, _ref;
      if (cancelIfNecessary == null) {
        cancelIfNecessary = false;
      }
      _ref = this.files.slice();
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        file = _ref[_i];
        if (file.status !== Dropzone.UPLOADING || cancelIfNecessary) {
          this.removeFile(file);
        }
      }
      return null;
    };

    Dropzone.prototype.createThumbnail = function(file, callback) {
      var fileReader;
      fileReader = new FileReader;
      fileReader.onload = (function(_this) {
        return function() {
          var img;
          img = document.createElement("img");
          img.onload = function() {
            var canvas, ctx, resizeInfo, thumbnail, _ref, _ref1, _ref2, _ref3;
            file.width = img.width;
            file.height = img.height;
            resizeInfo = _this.options.resize.call(_this, file);
            if (resizeInfo.trgWidth == null) {
              resizeInfo.trgWidth = resizeInfo.optWidth;
            }
            if (resizeInfo.trgHeight == null) {
              resizeInfo.trgHeight = resizeInfo.optHeight;
            }
            canvas = document.createElement("canvas");
            ctx = canvas.getContext("2d");
            canvas.width = resizeInfo.trgWidth;
            canvas.height = resizeInfo.trgHeight;
            drawImageIOSFix(ctx, img, (_ref = resizeInfo.srcX) != null ? _ref : 0, (_ref1 = resizeInfo.srcY) != null ? _ref1 : 0, resizeInfo.srcWidth, resizeInfo.srcHeight, (_ref2 = resizeInfo.trgX) != null ? _ref2 : 0, (_ref3 = resizeInfo.trgY) != null ? _ref3 : 0, resizeInfo.trgWidth, resizeInfo.trgHeight);
            thumbnail = canvas.toDataURL("image/png");
            _this.emit("thumbnail", file, thumbnail);
            if (callback != null) {
              return callback();
            }
          };
          return img.src = fileReader.result;
        };
      })(this);
      return fileReader.readAsDataURL(file);
    };

    Dropzone.prototype.processQueue = function() {
      var i, parallelUploads, processingLength, queuedFiles;
      parallelUploads = this.options.parallelUploads;
      processingLength = this.getUploadingFiles().length;
      i = processingLength;
      if (processingLength >= parallelUploads) {
        return;
      }
      queuedFiles = this.getQueuedFiles();
      if (!(queuedFiles.length > 0)) {
        return;
      }
      if (this.options.uploadMultiple) {
        return this.processFiles(queuedFiles.slice(0, parallelUploads - processingLength));
      } else {
        while (i < parallelUploads) {
          if (!queuedFiles.length) {
            return;
          }
          this.processFile(queuedFiles.shift());
          i++;
        }
      }
    };

    Dropzone.prototype.processFile = function(file) {
      return this.processFiles([file]);
    };

    Dropzone.prototype.processFiles = function(files) {
      var file, _i, _len;
      for (_i = 0, _len = files.length; _i < _len; _i++) {
        file = files[_i];
        file.processing = true;
        file.status = Dropzone.UPLOADING;
        this.emit("processing", file);
      }
      if (this.options.uploadMultiple) {
        this.emit("processingmultiple", files);
      }
      return this.uploadFiles(files);
    };

    Dropzone.prototype._getFilesWithXhr = function(xhr) {
      var file, files;
      return files = (function() {
        var _i, _len, _ref, _results;
        _ref = this.files;
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          file = _ref[_i];
          if (file.xhr === xhr) {
            _results.push(file);
          }
        }
        return _results;
      }).call(this);
    };

    Dropzone.prototype.cancelUpload = function(file) {
      var groupedFile, groupedFiles, _i, _j, _len, _len1, _ref;
      if (file.status === Dropzone.UPLOADING) {
        groupedFiles = this._getFilesWithXhr(file.xhr);
        for (_i = 0, _len = groupedFiles.length; _i < _len; _i++) {
          groupedFile = groupedFiles[_i];
          groupedFile.status = Dropzone.CANCELED;
        }
        file.xhr.abort();
        for (_j = 0, _len1 = groupedFiles.length; _j < _len1; _j++) {
          groupedFile = groupedFiles[_j];
          this.emit("canceled", groupedFile);
        }
        if (this.options.uploadMultiple) {
          this.emit("canceledmultiple", groupedFiles);
        }
      } else if ((_ref = file.status) === Dropzone.ADDED || _ref === Dropzone.QUEUED) {
        file.status = Dropzone.CANCELED;
        this.emit("canceled", file);
        if (this.options.uploadMultiple) {
          this.emit("canceledmultiple", [file]);
        }
      }
      if (this.options.autoProcessQueue) {
        return this.processQueue();
      }
    };

    Dropzone.prototype.uploadFile = function(file) {
      return this.uploadFiles([file]);
    };

    Dropzone.prototype.uploadFiles = function(files) {
      var file, formData, handleError, headerName, headerValue, headers, i, input, inputName, inputType, key, option, progressObj, response, updateProgress, value, xhr, _i, _j, _k, _l, _len, _len1, _len2, _len3, _m, _ref, _ref1, _ref2, _ref3, _ref4, _ref5;
      xhr = new XMLHttpRequest();
      for (_i = 0, _len = files.length; _i < _len; _i++) {
        file = files[_i];
        file.xhr = xhr;
      }
      xhr.open(this.options.method, this.options.url, true);
      xhr.withCredentials = !!this.options.withCredentials;
      response = null;
      handleError = (function(_this) {
        return function() {
          var _j, _len1, _results;
          _results = [];
          for (_j = 0, _len1 = files.length; _j < _len1; _j++) {
            file = files[_j];
            _results.push(_this._errorProcessing(files, response || _this.options.dictResponseError.replace("{{statusCode}}", xhr.status), xhr));
          }
          return _results;
        };
      })(this);
      updateProgress = (function(_this) {
        return function(e) {
          var allFilesFinished, progress, _j, _k, _l, _len1, _len2, _len3, _results;
          if (e != null) {
            progress = 100 * e.loaded / e.total;
            for (_j = 0, _len1 = files.length; _j < _len1; _j++) {
              file = files[_j];
              file.upload = {
                progress: progress,
                total: e.total,
                bytesSent: e.loaded
              };
            }
          } else {
            allFilesFinished = true;
            progress = 100;
            for (_k = 0, _len2 = files.length; _k < _len2; _k++) {
              file = files[_k];
              if (!(file.upload.progress === 100 && file.upload.bytesSent === file.upload.total)) {
                allFilesFinished = false;
              }
              file.upload.progress = progress;
              file.upload.bytesSent = file.upload.total;
            }
            if (allFilesFinished) {
              return;
            }
          }
          _results = [];
          for (_l = 0, _len3 = files.length; _l < _len3; _l++) {
            file = files[_l];
            _results.push(_this.emit("uploadprogress", file, progress, file.upload.bytesSent));
          }
          return _results;
        };
      })(this);
      xhr.onload = (function(_this) {
        return function(e) {
          var _ref;
          if (files[0].status === Dropzone.CANCELED) {
            return;
          }
          if (xhr.readyState !== 4) {
            return;
          }
          response = xhr.responseText;
          if (xhr.getResponseHeader("content-type") && ~xhr.getResponseHeader("content-type").indexOf("application/json")) {
            try {
              response = JSON.parse(response);
            } catch (_error) {
              e = _error;
              response = "Invalid JSON response from server.";
            }
          }
          updateProgress();
          if (!((200 <= (_ref = xhr.status) && _ref < 300))) {
            return handleError();
          } else {
            return _this._finished(files, response, e);
          }
        };
      })(this);
      xhr.onerror = (function(_this) {
        return function() {
          if (files[0].status === Dropzone.CANCELED) {
            return;
          }
          return handleError();
        };
      })(this);
      progressObj = (_ref = xhr.upload) != null ? _ref : xhr;
      progressObj.onprogress = updateProgress;
      headers = {
        "Accept": "application/json",
        "Cache-Control": "no-cache",
        "X-Requested-With": "XMLHttpRequest"
      };
      if (this.options.headers) {
        extend(headers, this.options.headers);
      }
      for (headerName in headers) {
        headerValue = headers[headerName];
        xhr.setRequestHeader(headerName, headerValue);
      }
      formData = new FormData();
      if (this.options.params) {
        _ref1 = this.options.params;
        for (key in _ref1) {
          value = _ref1[key];
          formData.append(key, value);
        }
      }
      for (_j = 0, _len1 = files.length; _j < _len1; _j++) {
        file = files[_j];
        this.emit("sending", file, xhr, formData);
      }
      if (this.options.uploadMultiple) {
        this.emit("sendingmultiple", files, xhr, formData);
      }
      if (this.element.tagName === "FORM") {
        _ref2 = this.element.querySelectorAll("input, textarea, select, button");
        for (_k = 0, _len2 = _ref2.length; _k < _len2; _k++) {
          input = _ref2[_k];
          inputName = input.getAttribute("name");
          inputType = input.getAttribute("type");
          if (input.tagName === "SELECT" && input.hasAttribute("multiple")) {
            _ref3 = input.options;
            for (_l = 0, _len3 = _ref3.length; _l < _len3; _l++) {
              option = _ref3[_l];
              if (option.selected) {
                formData.append(inputName, option.value);
              }
            }
          } else if (!inputType || ((_ref4 = inputType.toLowerCase()) !== "checkbox" && _ref4 !== "radio") || input.checked) {
            formData.append(inputName, input.value);
          }
        }
      }
      for (i = _m = 0, _ref5 = files.length - 1; 0 <= _ref5 ? _m <= _ref5 : _m >= _ref5; i = 0 <= _ref5 ? ++_m : --_m) {
        formData.append(this._getParamName(i), files[i], files[i].name);
      }
      return xhr.send(formData);
    };

    Dropzone.prototype._finished = function(files, responseText, e) {
      var file, _i, _len;
      for (_i = 0, _len = files.length; _i < _len; _i++) {
        file = files[_i];
        file.status = Dropzone.SUCCESS;
        this.emit("success", file, responseText, e);
        this.emit("complete", file);
      }
      if (this.options.uploadMultiple) {
        this.emit("successmultiple", files, responseText, e);
        this.emit("completemultiple", files);
      }
      if (this.options.autoProcessQueue) {
        return this.processQueue();
      }
    };

    Dropzone.prototype._errorProcessing = function(files, message, xhr) {
      var file, _i, _len;
      for (_i = 0, _len = files.length; _i < _len; _i++) {
        file = files[_i];
        file.status = Dropzone.ERROR;
        this.emit("error", file, message, xhr);
        this.emit("complete", file);
      }
      if (this.options.uploadMultiple) {
        this.emit("errormultiple", files, message, xhr);
        this.emit("completemultiple", files);
      }
      if (this.options.autoProcessQueue) {
        return this.processQueue();
      }
    };

    return Dropzone;

  })(Em);

  Dropzone.version = "3.10.2";

  Dropzone.options = {};

  Dropzone.optionsForElement = function(element) {
    if (element.getAttribute("id")) {
      return Dropzone.options[camelize(element.getAttribute("id"))];
    } else {
      return void 0;
    }
  };

  Dropzone.instances = [];

  Dropzone.forElement = function(element) {
    if (typeof element === "string") {
      element = document.querySelector(element);
    }
    if ((element != null ? element.dropzone : void 0) == null) {
      throw new Error("No Dropzone found for given element. This is probably because you're trying to access it before Dropzone had the time to initialize. Use the `init` option to setup any additional observers on your Dropzone.");
    }
    return element.dropzone;
  };

  Dropzone.autoDiscover = true;

  Dropzone.discover = function() {
    var checkElements, dropzone, dropzones, _i, _len, _results;
    if (document.querySelectorAll) {
      dropzones = document.querySelectorAll(".dropzone");
    } else {
      dropzones = [];
      checkElements = function(elements) {
        var el, _i, _len, _results;
        _results = [];
        for (_i = 0, _len = elements.length; _i < _len; _i++) {
          el = elements[_i];
          if (/(^| )dropzone($| )/.test(el.className)) {
            _results.push(dropzones.push(el));
          } else {
            _results.push(void 0);
          }
        }
        return _results;
      };
      checkElements(document.getElementsByTagName("div"));
      checkElements(document.getElementsByTagName("form"));
    }
    _results = [];
    for (_i = 0, _len = dropzones.length; _i < _len; _i++) {
      dropzone = dropzones[_i];
      if (Dropzone.optionsForElement(dropzone) !== false) {
        _results.push(new Dropzone(dropzone));
      } else {
        _results.push(void 0);
      }
    }
    return _results;
  };

  Dropzone.blacklistedBrowsers = [/opera.*Macintosh.*version\/12/i];

  Dropzone.isBrowserSupported = function() {
    var capableBrowser, regex, _i, _len, _ref;
    capableBrowser = true;
    if (window.File && window.FileReader && window.FileList && window.Blob && window.FormData && document.querySelector) {
      if (!("classList" in document.createElement("a"))) {
        capableBrowser = false;
      } else {
        _ref = Dropzone.blacklistedBrowsers;
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          regex = _ref[_i];
          if (regex.test(navigator.userAgent)) {
            capableBrowser = false;
            continue;
          }
        }
      }
    } else {
      capableBrowser = false;
    }
    return capableBrowser;
  };

  without = function(list, rejectedItem) {
    var item, _i, _len, _results;
    _results = [];
    for (_i = 0, _len = list.length; _i < _len; _i++) {
      item = list[_i];
      if (item !== rejectedItem) {
        _results.push(item);
      }
    }
    return _results;
  };

  camelize = function(str) {
    return str.replace(/[\-_](\w)/g, function(match) {
      return match.charAt(1).toUpperCase();
    });
  };

  Dropzone.createElement = function(string) {
    var div;
    div = document.createElement("div");
    div.innerHTML = string;
    return div.childNodes[0];
  };

  Dropzone.elementInside = function(element, container) {
    if (element === container) {
      return true;
    }
    while (element = element.parentNode) {
      if (element === container) {
        return true;
      }
    }
    return false;
  };

  Dropzone.getElement = function(el, name) {
    var element;
    if (typeof el === "string") {
      element = document.querySelector(el);
    } else if (el.nodeType != null) {
      element = el;
    }
    if (element == null) {
      throw new Error("Invalid `" + name + "` option provided. Please provide a CSS selector or a plain HTML element.");
    }
    return element;
  };

  Dropzone.getElements = function(els, name) {
    var e, el, elements, _i, _j, _len, _len1, _ref;
    if (els instanceof Array) {
      elements = [];
      try {
        for (_i = 0, _len = els.length; _i < _len; _i++) {
          el = els[_i];
          elements.push(this.getElement(el, name));
        }
      } catch (_error) {
        e = _error;
        elements = null;
      }
    } else if (typeof els === "string") {
      elements = [];
      _ref = document.querySelectorAll(els);
      for (_j = 0, _len1 = _ref.length; _j < _len1; _j++) {
        el = _ref[_j];
        elements.push(el);
      }
    } else if (els.nodeType != null) {
      elements = [els];
    }
    if (!((elements != null) && elements.length)) {
      throw new Error("Invalid `" + name + "` option provided. Please provide a CSS selector, a plain HTML element or a list of those.");
    }
    return elements;
  };

  Dropzone.confirm = function(question, accepted, rejected) {
    if (window.confirm(question)) {
      return accepted();
    } else if (rejected != null) {
      return rejected();
    }
  };

  Dropzone.isValidFile = function(file, acceptedFiles) {
    var baseMimeType, mimeType, validType, _i, _len;
    if (!acceptedFiles) {
      return true;
    }
    acceptedFiles = acceptedFiles.split(",");
    mimeType = file.type;
    baseMimeType = mimeType.replace(/\/.*$/, "");
    for (_i = 0, _len = acceptedFiles.length; _i < _len; _i++) {
      validType = acceptedFiles[_i];
      validType = validType.trim();
      if (validType.charAt(0) === ".") {
        if (file.name.toLowerCase().indexOf(validType.toLowerCase(), file.name.length - validType.length) !== -1) {
          return true;
        }
      } else if (/\/\*$/.test(validType)) {
        if (baseMimeType === validType.replace(/\/.*$/, "")) {
          return true;
        }
      } else {
        if (mimeType === validType) {
          return true;
        }
      }
    }
    return false;
  };

  if (typeof jQuery !== "undefined" && jQuery !== null) {
    jQuery.fn.dropzone = function(options) {
      return this.each(function() {
        return new Dropzone(this, options);
      });
    };
  }

  if (typeof module !== "undefined" && module !== null) {
    module.exports = Dropzone;
  } else {
    window.Dropzone = Dropzone;
  }

  Dropzone.ADDED = "added";

  Dropzone.QUEUED = "queued";

  Dropzone.ACCEPTED = Dropzone.QUEUED;

  Dropzone.UPLOADING = "uploading";

  Dropzone.PROCESSING = Dropzone.UPLOADING;

  Dropzone.CANCELED = "canceled";

  Dropzone.ERROR = "error";

  Dropzone.SUCCESS = "success";


  /*
  
  Bugfix for iOS 6 and 7
  Source: http://stackoverflow.com/questions/11929099/html5-canvas-drawimage-ratio-bug-ios
  based on the work of https://github.com/stomita/ios-imagefile-megapixel
   */

  detectVerticalSquash = function(img) {
    var alpha, canvas, ctx, data, ey, ih, iw, py, ratio, sy;
    iw = img.naturalWidth;
    ih = img.naturalHeight;
    canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = ih;
    ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    data = ctx.getImageData(0, 0, 1, ih).data;
    sy = 0;
    ey = ih;
    py = ih;
    while (py > sy) {
      alpha = data[(py - 1) * 4 + 3];
      if (alpha === 0) {
        ey = py;
      } else {
        sy = py;
      }
      py = (ey + sy) >> 1;
    }
    ratio = py / ih;
    if (ratio === 0) {
      return 1;
    } else {
      return ratio;
    }
  };

  drawImageIOSFix = function(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
    var vertSquashRatio;
    vertSquashRatio = detectVerticalSquash(img);
    return ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh / vertSquashRatio);
  };


  /*
   * contentloaded.js
   *
   * Author: Diego Perini (diego.perini at gmail.com)
   * Summary: cross-browser wrapper for DOMContentLoaded
   * Updated: 20101020
   * License: MIT
   * Version: 1.2
   *
   * URL:
   * http://javascript.nwbox.com/ContentLoaded/
   * http://javascript.nwbox.com/ContentLoaded/MIT-LICENSE
   */

  contentLoaded = function(win, fn) {
    var add, doc, done, init, poll, pre, rem, root, top;
    done = false;
    top = true;
    doc = win.document;
    root = doc.documentElement;
    add = (doc.addEventListener ? "addEventListener" : "attachEvent");
    rem = (doc.addEventListener ? "removeEventListener" : "detachEvent");
    pre = (doc.addEventListener ? "" : "on");
    init = function(e) {
      if (e.type === "readystatechange" && doc.readyState !== "complete") {
        return;
      }
      (e.type === "load" ? win : doc)[rem](pre + e.type, init, false);
      if (!done && (done = true)) {
        return fn.call(win, e.type || e);
      }
    };
    poll = function() {
      var e;
      try {
        root.doScroll("left");
      } catch (_error) {
        e = _error;
        setTimeout(poll, 50);
        return;
      }
      return init("poll");
    };
    if (doc.readyState !== "complete") {
      if (doc.createEventObject && root.doScroll) {
        try {
          top = !win.frameElement;
        } catch (_error) {}
        if (top) {
          poll();
        }
      }
      doc[add](pre + "DOMContentLoaded", init, false);
      doc[add](pre + "readystatechange", init, false);
      return win[add](pre + "load", init, false);
    }
  };

  Dropzone._autoDiscoverFunction = function() {
    if (Dropzone.autoDiscover) {
      return Dropzone.discover();
    }
  };

  contentLoaded(window, Dropzone._autoDiscoverFunction);

}).call(this);

});

if (typeof exports == "object") {
  module.exports = require("dropzone");
} else if (typeof define == "function" && define.amd) {
  define([], function(){ return require("dropzone"); });
} else {
  this["Dropzone"] = require("dropzone");
}
})()
