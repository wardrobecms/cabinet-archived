<?php namespace Wardrobe\Cabinet\Entities;

abstract class Entity extends \Illuminate\Database\Eloquent\Model {

	/**
	 * Get the query for a one-to-one association.
	 *
	 * @param  string  $related
	 * @param  string  $foreignKey
	 * @param  string  $localKey
	 * @return Relationship
	 */
	public function hasOne($related, $foreignKey = null, $localKey = null)
	{
		return parent::hasOne('Wardrobe\\Cabinet\\Entities\\'.$model, $foreignKey, $localKey);
	}

	/**
	 * Get the query for a one-to-many association.
	 *
	 * @param  string  $related
	 * @param  string  $foreignKey
	 * @param  string  $localKey
	 * @return Relationship
	 */
	public function hasMany($related, $foreignKey = null, $localKey = null)
	{
		return parent::hasMany('Wardrobe\\Cabinet\\Entities\\'.$related, $foreignKey, $localKey);
	}

	/**
	 * Get the query for a one-to-one (inverse) relationship.
	 *
	 * @param  string  $related
	 * @param  string  $foreignKey
	 * @param  string  $otherKey
	 * @param  string  $relation
	 * @return Relationship
	 */
	public function belongsTo($related, $foreignKey = null, $otherKey = null, $relation = null)
	{
		return parent::belongsTo('Wardrobe\\Cabinet\\Entities\\'.$related, $foreignKey, $otherKey, $relation);
	}

	/**
	 * Get the query for a many-to-many relationship.
	 *
	 * @param  string  $related
	 * @param  string  $table
	 * @param  string  $foreignKey
	 * @param  string  $otherKey
	 * @param  string  $relation
	 * @return Relationship
	 */
	public function belongsToMany($related, $table = null, $foreignKey = null, $otherKey = null, $relation = null)
	{
		return parent::belongsToMany('Wardrobe\\Cabinet\\Entities\\'.$related, $table, $foreignKey, $otherKey, $relation);
	}

}
